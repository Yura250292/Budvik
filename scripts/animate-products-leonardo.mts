/**
 * Оживлення карток товару: фото -> коротке відео через Leonardo.Ai (image-to-video).
 *
 * Беремо «основні позиції» (за замовчуванням — топ продажів за останні місяці
 * серед активних товарів із фото і залишком), заливаємо фото як init image,
 * запускаємо motion-генерацію і чекаємо на mp4. Результат — у output/leonardo/,
 * поруч manifest.json, щоб повторний запуск не платив двічі за те саме.
 *
 * Ключ: LEONARDO_API_KEY у .env (Bearer-токен з cloud.leonardo.ai).
 * Кредити списуються за КОЖНУ генерацію — завжди спершу --dry, потім --limit 2.
 *
 * Запуск:
 *   npx tsx --env-file=.env scripts/animate-products-leonardo.mts --dry
 *   npx tsx --env-file=.env scripts/animate-products-leonardo.mts --limit 3 --apply
 *   npx tsx --env-file=.env scripts/animate-products-leonardo.mts --sku 12345,67890 --apply
 *   npx tsx --env-file=.env scripts/animate-products-leonardo.mts --source promo --limit 5 --apply
 *   ... --motion turntable|push|light|orbit   який рух просити в моделі
 */
import { PrismaClient } from "@prisma/client";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const prisma = new PrismaClient();

// ---------- аргументи ----------
const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};

const APPLY = flag("apply");
const DRY = !APPLY;
const LIMIT = Number(opt("limit", "5"));
const MONTHS = Number(opt("months", "6"));
const SOURCE = opt("source", "sales") as "sales" | "promo" | "stock";
const BRAND = opt("brand", "");
const SKUS = opt("sku", "").split(",").map((s) => s.trim()).filter(Boolean);
const RESOLUTION = opt("resolution", "480") === "720" ? "RESOLUTION_720" : "RESOLUTION_480";
const POLL_TIMEOUT_MS = Number(opt("timeout", "600")) * 1000;
const OUT_DIR = path.resolve(opt("out", "output/leonardo"));
// Топ продажів — це три однакові відрізні круги поспіль. За замовчуванням
// лишаємо по одній позиції на «бренд + тип предмета», --all-same вимикає.
const DIVERSE = !flag("all-same");
// Який саме рух просити: orbit (за замовчуванням), turntable, push, light.
const MOTION_KEY = opt("motion", "orbit");
// promptEnhance Leonardo сама дописує промпт і зазвичай додає руху.
const ENHANCE = !flag("no-enhance");
const MANIFEST = path.join(OUT_DIR, "manifest.json");

const API = "https://cloud.leonardo.ai/api/rest/v1";
// Motion 2.0 image-to-video коштує 200 API-кредитів за кліп (480p).
// Це ОКРЕМИЙ гаманець від токенів вебзастосунку — ними API не платить.
const COST_PER_VIDEO = 200;
const KEY = process.env.LEONARDO_API_KEY ?? "";

// ---------- добір позицій ----------
type Pick = {
  id: string;
  sku: string | null;
  name: string;
  image: string;
  brand: string | null;
  toolType: string | null;
  metric: number;
};

async function pickProducts(): Promise<Pick[]> {
  if (SKUS.length) {
    const rows = await prisma.product.findMany({
      where: { sku: { in: SKUS }, image: { not: null } },
      include: { brand: true },
    });
    return rows.map((p) => ({
      id: p.id, sku: p.sku, name: p.name, image: p.image!,
      brand: p.brand?.name ?? null, toolType: p.toolType, metric: 0,
    }));
  }

  if (SOURCE === "promo" || SOURCE === "stock") {
    const rows = await prisma.product.findMany({
      where: {
        isActive: true,
        image: { not: null },
        stock: { gt: 0 },
        ...(SOURCE === "promo" ? { isPromo: true } : {}),
        ...(BRAND ? { brand: { name: { contains: BRAND, mode: "insensitive" as const } } } : {}),
      },
      include: { brand: true },
      orderBy: [{ priority: "desc" }, { stock: "desc" }],
      take: LIMIT,
    });
    return rows.map((p) => ({
      id: p.id, sku: p.sku, name: p.name, image: p.image!,
      brand: p.brand?.name ?? null, toolType: p.toolType, metric: p.stock,
    }));
  }

  // Топ продажів. RETURN у нас із мінусом у quantity, тож SUM одразу чистий.
  const since = new Date();
  since.setMonth(since.getMonth() - MONTHS);
  const rows = await prisma.$queryRawUnsafe<
    { id: string; sku: string | null; name: string; image: string; brand: string | null; toolType: string | null; metric: number }[]
  >(
    `SELECT p.id, p.sku, p.name, p.image, b.name AS brand, p."toolType",
            SUM(i.quantity)::float AS metric
       FROM "SalesDocumentItem" i
       JOIN "SalesDocument" d ON d.id = i."salesDocumentId"
       JOIN "Product" p       ON p.id = i."productId"
       LEFT JOIN "Brand" b    ON b.id = p."brandId"
      WHERE d."createdAt" >= $1
        AND p."isActive" = true
        AND p.image IS NOT NULL AND p.image <> ''
        AND p.stock > 0
        ${BRAND ? `AND b.name ILIKE '%' || $3 || '%'` : ""}
      GROUP BY p.id, p.sku, p.name, p.image, b.name, p."toolType"
     HAVING SUM(i.quantity) > 0
      ORDER BY metric DESC
      LIMIT $2`,
    since,
    DIVERSE ? LIMIT * 10 : LIMIT,
    ...(BRAND ? [BRAND] : []),
  );
  return dedupe(rows);
}

function dedupe(rows: Pick[]): Pick[] {
  if (!DIVERSE) return rows.slice(0, LIMIT);
  const seen = new Set<string>();
  const out: Pick[] = [];
  for (const p of rows) {
    const key = `${p.brand ?? ""}|${subjectOf(p)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
    if (out.length >= LIMIT) break;
  }
  return out;
}

// ---------- промпт ----------
// Українська назва з 1С («Дриль ударний STREND PRO 810Вт») моделі нічого не
// каже, тому предмет підбираємо словником, а решта промпту — про камеру.
const SUBJECT_UK_EN: [RegExp, string][] = [
  [/дриль|дрел/i, "a cordless power drill"],
  [/шурупов|шурупок/i, "a cordless screwdriver"],
  [/болгар|кутова шліф|УШМ/i, "an angle grinder"],
  [/перфорат/i, "a rotary hammer drill"],
  [/лобзик/i, "a jigsaw power tool"],
  [/пил[аи]|циркуляр/i, "a circular saw"],
  [/шліфмаш|шліфув/i, "a sander power tool"],
  [/компрес/i, "an air compressor"],
  [/генератор/i, "a portable generator"],
  [/фарб|емал|ґрунт|грунт/i, "a paint can"],
  [/шурупи|саморіз|цвях|дюбел|анкер/i, "a box of construction fasteners"],
  [/диск|коло відрізн|круг/i, "a set of cutting discs"],
  [/рукавиц|рукавич|окуляр|каск|респірат/i, "protective work gear"],
  [/ключ|голівк|набір інструм/i, "a set of hand tools"],
  [/лопат|граблі|тачк/i, "a garden tool"],
  [/кабел|провід|розетк|подовжув/i, "electrical hardware"],
];

const SUBJECT_BY_TYPE: Record<string, string> = {
  drill: "a cordless power drill",
  grinder: "an angle grinder",
  saw: "a circular saw",
  jigsaw: "a jigsaw power tool",
  sander: "a sander power tool",
};

function subjectOf(p: Pick): string {
  if (p.toolType && SUBJECT_BY_TYPE[p.toolType]) return SUBJECT_BY_TYPE[p.toolType];
  for (const [re, en] of SUBJECT_UK_EN) if (re.test(p.name)) return en;
  return "a hardware store product";
}

// ПЕРША ПРОБА БУЛА СТАТИЧНОЮ: у промпті стояло «the product stays perfectly
// still» + «very slow» — WAN21 послухався і 4 з 5 секунд віддав нерухомий кадр
// (різниця між кадрами 0,1 з 255). Тепер рух просимо явно, а незмінність —
// тільки про форму й лого, не про камеру.
const MOTION: Record<string, (subject: string) => string> = {
  orbit: (s) =>
    `Cinematic product video: the camera slowly orbits around ${s} from left to right, ` +
    "revealing its depth and volume, with clear parallax between the tool and the background.",
  turntable: (s) =>
    `Cinematic product video: ${s} slowly rotates on a turntable, showing its side and front, ` +
    "the camera stays locked off.",
  push: (s) =>
    `Cinematic product video: the camera dollies in on ${s}, moving closer through the frame ` +
    "with visible perspective change and shifting highlights.",
  light: (s) =>
    `Cinematic product video of ${s}: a hard studio light sweeps across the body from left to right, ` +
    "specular highlights travel over the metal and plastic while the camera drifts slightly.",
};

function promptOf(p: Pick): string {
  const subject = subjectOf(p);
  const move = (MOTION[MOTION_KEY] ?? MOTION.orbit)(subject);
  return [
    move,
    "Clean seamless studio background, soft shadow under the product.",
    "The product keeps its exact shape, proportions, colors and logo throughout — only the camera and the light move.",
    "Photorealistic commercial e-commerce footage, no extra objects, no hands, no text.",
  ].join(" ");
}

// ---------- Leonardo API ----------
async function api(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${KEY}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Leonardo ${pathname} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// Ключі відповіді Leonardo мінялися (sdGenerationJob / motionSvdGenerationJob /
// motionVideoGenerationJob), тож не прив'язуємось до назви — шукаємо по дереву.
function deepFind(obj: unknown, test: (k: string, v: unknown) => boolean): unknown {
  const stack: unknown[] = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    for (const [k, v] of Object.entries(cur as Record<string, unknown>)) {
      if (test(k, v)) return v;
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return undefined;
}

async function downloadImage(url: string): Promise<{ buf: Buffer; ext: string }> {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (budvik-animate)" } });
  if (!res.ok) throw new Error(`фото ${res.status} ${url}`);
  const type = res.headers.get("content-type") ?? "";
  const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
  return { buf: Buffer.from(await res.arrayBuffer()), ext };
}

async function uploadInitImage(buf: Buffer, ext: string): Promise<string> {
  const res = await api("/init-image", { method: "POST", body: JSON.stringify({ extension: ext }) });
  const u = res.uploadInitImage;
  if (!u?.url || !u?.id) throw new Error(`init-image без url/id: ${JSON.stringify(res).slice(0, 300)}`);
  const fields: Record<string, string> = typeof u.fields === "string" ? JSON.parse(u.fields) : u.fields;

  // Presigned URL живе 2 хвилини, і ключ API до нього НЕ передається.
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append("file", new Blob([new Uint8Array(buf)]), `image.${ext}`);
  const up = await fetch(u.url, { method: "POST", body: form });
  if (up.status !== 204 && !up.ok) throw new Error(`upload ${up.status}: ${(await up.text()).slice(0, 300)}`);
  return u.id as string;
}

async function apiBalance(): Promise<number> {
  const res = await api("/me");
  const d = res.user_details?.[0] ?? {};
  return Number(d.apiPaidTokens ?? 0) + Number(d.apiSubscriptionTokens ?? 0);
}

async function startMotion(imageId: string, prompt: string): Promise<string> {
  const res = await api("/generations-image-to-video", {
    method: "POST",
    body: JSON.stringify({
      imageId,
      imageType: "UPLOADED",
      prompt,
      resolution: RESOLUTION,
      frameInterpolation: true,
      promptEnhance: ENHANCE,
      isPublic: false,
    }),
  });
  const id = deepFind(res, (k, v) => k === "generationId" && typeof v === "string");
  if (typeof id !== "string") throw new Error(`немає generationId: ${JSON.stringify(res).slice(0, 300)}`);
  const cost = deepFind(res, (k, v) => k === "apiCreditCost" && typeof v === "number");
  if (typeof cost === "number") console.log(`  списано кредитів: ${cost}`);
  return id;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForVideo(generationId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(10_000);
    const res = await api(`/generations/${generationId}`);
    const url = deepFind(res, (_k, v) => typeof v === "string" && /^https?:\/\/.*\.mp4/i.test(v));
    if (typeof url === "string") return url;
    const status = deepFind(res, (k) => k === "status");
    if (status === "FAILED") throw new Error("генерація FAILED");
    process.stdout.write(".");
  }
  throw new Error("таймаут очікування відео");
}

// ---------- маніфест ----------
type Entry = { productId: string; sku: string | null; name: string; generationId: string; videoUrl: string; file: string; at: string };

async function loadManifest(): Promise<Entry[]> {
  if (!existsSync(MANIFEST)) return [];
  try { return JSON.parse(await readFile(MANIFEST, "utf8")); } catch { return []; }
}

function safeName(p: Pick): string {
  const base = `${p.sku ?? p.id}-${p.name}`.slice(0, 60);
  return base.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
}

// ---------- головне ----------
async function main() {
  const products = await pickProducts();
  console.log(`Відібрано ${products.length} позицій (джерело: ${SKUS.length ? "sku" : SOURCE}, ${RESOLUTION}, рух: ${MOTION_KEY}${ENHANCE ? " + promptEnhance" : ""})\n`);
  for (const p of products) {
    console.log(`• ${p.sku ?? "—"} ${p.name}${p.brand ? ` [${p.brand}]` : ""} — метрика ${p.metric}`);
    console.log(`  фото: ${p.image}`);
    console.log(`  промпт: ${promptOf(p)}\n`);
  }

  if (DRY) {
    console.log("Це --dry: жодного запиту в Leonardo, кредити не витрачені.");
    console.log("Щоб запустити: додай --apply (і LEONARDO_API_KEY у .env).");
    return;
  }
  if (!KEY) throw new Error("Немає LEONARDO_API_KEY у .env");

  const credits = await apiBalance();
  console.log(`API-кредитів на акаунті: ${credits} (~${Math.floor(credits / COST_PER_VIDEO)} відео по ${COST_PER_VIDEO})`);
  if (credits < COST_PER_VIDEO) {
    throw new Error("не вистачає API-кредитів навіть на одне відео — поповни саме API-план, токени вебзастосунку тут не рахуються");
  }
  if (credits < COST_PER_VIDEO * products.length) {
    console.log(`⚠ вистачить лише на ${Math.floor(credits / COST_PER_VIDEO)} із ${products.length} — решта впаде на 402`);
  }

  await mkdir(OUT_DIR, { recursive: true });
  const manifest = await loadManifest();
  const done = new Set(manifest.map((e) => e.productId));

  for (const p of products) {
    if (done.has(p.id)) { console.log(`↷ вже зроблено: ${p.name}`); continue; }
    try {
      console.log(`\n▶ ${p.name}`);
      const { buf, ext } = await downloadImage(p.image);
      const imageId = await uploadInitImage(buf, ext);
      console.log(`  init image: ${imageId}`);
      const generationId = await startMotion(imageId, promptOf(p));
      console.log(`  генерація: ${generationId}`);
      const videoUrl = await waitForVideo(generationId);
      const file = path.join(OUT_DIR, `${safeName(p)}.mp4`);
      const mp4 = await fetch(videoUrl);
      await writeFile(file, Buffer.from(await mp4.arrayBuffer()));
      console.log(`\n  ✔ ${file}`);

      manifest.push({
        productId: p.id, sku: p.sku, name: p.name,
        generationId, videoUrl, file, at: new Date().toISOString(),
      });
      await writeFile(MANIFEST, JSON.stringify(manifest, null, 2));
    } catch (e) {
      console.error(`  ✖ ${p.name}: ${(e as Error).message}`);
    }
  }

  console.log(`\nГотово. Відео в ${OUT_DIR}, журнал у ${MANIFEST}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
