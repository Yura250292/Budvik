/**
 * Оновлення повітрям — на ВСІ збірки, які справді є в полі.
 *
 * `npm run update:staff` публікує під один runtime: той, що записаний у
 * app.config.ts. Це здається очевидно правильним рівно доти, доки поле
 * одноверсійне, — а воно таким не буває ніколи. APK ставиться руками, руки
 * доходять не до всіх, і кожен планшет, який лишився на старій оболонці,
 * лишається ще й на старому JS. Назавжди: наступна публікація знову піде під
 * поточну версію, і знову його омине.
 *
 * Так 09.09.2026 виявилося, що шість планшетів із восьми возять JS від 1.5.1 і
 * 1.6.0 — без двох тижнів виправлень треку, які лежали опублікованими. Ручний
 * прийом «підмінити VERSION у конфізі, опублікувати, повернути назад» був
 * записаний у пам'яті ще з 01.09 і жодного разу не був зроблений: він вимагає
 * згадати про нього в потрібну мить, а не згадати нічого не коштує до вечора.
 *
 * Тому список версій береться не з голови, а з ПУЛЬСІВ: кожен планшет сам
 * каже, яка на ньому оболонка. Скрипт публікує під кожну з них.
 *
 * ЧОМУ ЦЕ БЕЗПЕЧНО. Свіжий JS на старій оболонці небезпечний рівно тоді, коли
 * він кличе нативний код, якого там немає. У цьому застосунку весь нативний
 * приріст із 1.5.1 — власний модуль `track-guard`, а його обгортка
 * (mobile/modules/track-guard/index.ts) бере модуль через
 * `requireOptionalNativeModule` і перевіряє КОЖНУ функцію окремо через
 * `typeof`: у старій збірці виклик тихо повертає false. `mobile/package.json`
 * із 1.5.1 не змінювався жодного разу, тобто нативних залежностей ззовні не
 * додавалося. Тому перед публікацією скрипт це й перевіряє сам — і відмовляє,
 * якщо package.json усе-таки роз'їхався.
 *
 * За замовчуванням лише показує план. Публікує з --apply:
 *
 *   npx tsx scripts/publish-staff-ota.mts "що саме виправлено"
 *   npx tsx scripts/publish-staff-ota.mts "що саме виправлено" --apply
 *   npx tsx scripts/publish-staff-ota.mts "…" --apply --only 1.6.2,1.6.1
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { prisma } from "../src/lib/prisma";
import { STAFF_APK_VERSION_NAME } from "../src/lib/app-builds";

const ROOT = path.resolve(import.meta.dirname, "..");
const MOBILE = path.join(ROOT, "mobile");

/**
 * Скільки днів пульсу вважати ознакою живого планшета.
 *
 * Два тижні: планшет, який мовчить довше, або лежить у шухляді, або в ремонті,
 * і публікувати під його версію — це зайвий бандл у сховищі й зайвий рядок у
 * розборі. А от відпустка на тиждень — не привід забути про людину.
 */
const ALIVE_DAYS = 14;

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const onlyArg = args.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? (onlyArg.includes("=") ? onlyArg.split("=")[1] : args[args.indexOf(onlyArg) + 1])
      ?.split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  : null;
const message = args.find((a) => !a.startsWith("--") && a !== only?.join(",")) ?? "";

if (!message) {
  console.error("Потрібен опис оновлення: npx tsx scripts/publish-staff-ota.mts \"що виправлено\"");
  process.exit(1);
}

const git = (a: string[]) => execFileSync("git", a, { cwd: ROOT, encoding: "utf-8" }).trim();

/**
 * Чи не з'явилося нативних залежностей із часів найстарішої збірки в полі.
 *
 * Єдина перевірка, яка стоїть між «довезли виправлення» і «застосунок падає на
 * старті в трьох людей одночасно». Якщо `mobile/package.json` змінювався після
 * того, як зібрано найстарішу оболонку, свіжий бандл може кликати нативний
 * модуль, якого в ній фізично немає, — і тоді старій збірці потрібен APK, а не
 * оновлення.
 *
 * Порівнюємо з комітом, у якому в app-builds.ts стояла ця версія: точнішого
 * маркера «коли зібрано ту оболонку» в репозиторії немає.
 */
function nativeDriftSince(version: string): string | null {
  const commits = git(["log", "--format=%h", "-60", "--", "src/lib/app-builds.ts"]).split("\n");
  let built: string | null = null;
  for (const c of commits) {
    const file = execFileSync("git", ["show", `${c}:src/lib/app-builds.ts`], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    const m = file.match(/STAFF_APK_VERSION_NAME\s*=\s*"([^"]+)"/);
    if (m?.[1] === version) built = c;
    else if (built) break; // пішли комміти ДО появи цієї версії — далі не треба
  }
  if (!built) return `не знайшов у git коміт, яким випущено ${version}`;

  /**
   * Порівнюємо САМІ ЗАЛЕЖНОСТІ, а не файл цілком.
   *
   * Перша версія цієї перевірки дивилася на `git diff` по всьому
   * `mobile/package.json` — і того ж дня зупинила публікацію через
   * перейменований npm-скрипт. Запобіжник, який спрацьовує на порожньому
   * місці, вимикають назавжди після другого разу, а цей вимикати не можна: він
   * єдиний стоїть між «довезли виправлення» і «застосунок падає на старті».
   *
   * Нативну оболонку визначають рівно `dependencies` і `devDependencies`
   * (серед других живуть плагіни конфігурації). `scripts`, `name`, версія
   * самого package.json на те, що зібрано в APK, не впливають ніяк.
   */
  const deps = (rev: string): string => {
    const raw = execFileSync("git", ["show", `${rev}:mobile/package.json`], {
      cwd: ROOT,
      encoding: "utf-8",
    });
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const dev = { ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}) };
    for (const name of BUILD_TOOLS) delete dev[name];
    return JSON.stringify({ d: pkg.dependencies ?? {}, dev });
  };

  if (deps(built) !== deps("HEAD")) {
    return `залежності mobile/package.json змінювалися після ${version} (${built})`;
  }

  /**
   * Патчі нативних модулів — окремо від залежностей.
   *
   * Патч міняє код УСЕРЕДИНІ модуля, і в старій оболонці його просто немає. Для
   * JS це безпечно, доки патч не чіпає того, що JS бачить: оголошень функцій і
   * властивостей модуля. Внутрішня логіка (як 19d1788 у expo-location) лише
   * змінює поведінку служби — стара оболонка поводиться, як поводилася.
   * Новий або змінений виклик — інша справа: свіжий JS кликав би функцію, якої
   * там немає, і падав би на старті. Такий патч зупиняє публікацію.
   */
  const patchDiff = git(["diff", built, "HEAD", "--", "mobile/patches"]);
  const apiLines = patchDiff
    .split("\n")
    .filter((l) => /^[+-]{2}[^+-]/.test(l) && /\b(AsyncFunction|Function|Property|Constants|Events)\s*\(/.test(l));
  return apiLines.length === 0
    ? null
    : `патч нативного модуля після ${version} (${built}) змінює API для JS:\n     ${apiLines.join("\n     ")}`;
}

/**
 * Інструменти збірки, які живуть у devDependencies, але модулем в APK не стають.
 *
 * `patch-package` лише накладає патчі на node_modules під час встановлення. Сам
 * по собі він не додає оболонці жодного нативного модуля — а те, що накладають
 * патчі, перевіряється нижче окремо. 13.09.2026 без цього списку запобіжник
 * зупинив публікацію на 1.6.2, 1.6.1 і 1.5.1 через один рядок у devDependencies.
 */
const BUILD_TOOLS = ["patch-package"];

async function main() {
  const since = new Date(Date.now() - ALIVE_DAYS * 24 * 3600_000);

  /**
   * Версія оболонки — це перше слово `appVersion` у пульсі: «1.6.2 ota.01a080fa»
   * означає нативну 1.6.2 з оновленням поверх. Саме нативна частина й вирішує,
   * під який runtime публікувати; хвіст після пробілу тут ні до чого.
   */
  const beats = await prisma.deviceHeartbeat.findMany({
    where: { at: { gte: since }, appVersion: { not: null } },
    orderBy: { at: "desc" },
    select: { userId: true, at: true, appVersion: true, user: { select: { name: true } } },
  });

  const byUser = new Map<string, { name: string; version: string; at: Date }>();
  for (const b of beats) {
    if (byUser.has(b.userId)) continue;
    const version = (b.appVersion ?? "").split(" ")[0];
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    byUser.set(b.userId, { name: b.user?.name ?? b.userId, version, at: b.at });
  }

  const field = new Map<string, string[]>();
  for (const { name, version } of byUser.values()) {
    field.set(version, [...(field.get(version) ?? []), name]);
  }
  // Поточну версію публікуємо завжди, навіть якщо жоден планшет ще не озвався:
  // саме на неї встановлюють APK просто зараз.
  if (!field.has(STAFF_APK_VERSION_NAME)) field.set(STAFF_APK_VERSION_NAME, []);

  const versions = [...field.keys()].sort().reverse().filter((v) => !only || only.includes(v));

  console.log(`\nЖиві оболонки в полі за ${ALIVE_DAYS} днів\n${"=".repeat(60)}`);
  for (const v of [...field.keys()].sort().reverse()) {
    const people = field.get(v)!;
    const mark = versions.includes(v) ? "→" : "·";
    console.log(`${mark} ${v.padEnd(8)} ${people.length ? people.join(", ") : "(ще ніхто не озвався)"}`);
  }

  const oldest = versions[versions.length - 1];
  const drift = oldest ? nativeDriftSince(oldest) : "у полі не видно жодної версії";
  if (drift) {
    console.error(`\n❌ Публікацію зупинено: ${drift}.`);
    console.error("   Стара оболонка може не мати нативного модуля, який кличе свіжий JS.");
    console.error("   Обмежте список: --only <версії, для яких перевірка чиста>.");
    process.exit(1);
  }
  console.log(`\nНативних залежностей не додавалося з ${oldest} — свіжий JS сумісний з усіма.`);

  if (!apply) {
    console.log(`\nЦе показ. Публікувати: додайте --apply (${versions.length} публікацій).`);
    await prisma.$disconnect();
    return;
  }

  for (const v of versions) {
    const isCurrent = v === STAFF_APK_VERSION_NAME;
    console.log(`\n— публікую під staff-${v}${isCurrent ? " (поточна)" : " (стара оболонка)"}`);
    execFileSync(
      "npx",
      ["eas", "update", "--channel", "staff", "--platform", "android", "--message", message],
      {
        cwd: MOBILE,
        stdio: "inherit",
        env: {
          ...process.env,
          APP_FLAVOR: "staff",
          EXPO_PUBLIC_API_URL: "https://www.budvik27.com",
          // Поточну версію публікуємо без підміни: хай конфіг говорить сам за себе.
          ...(isCurrent ? {} : { STAFF_OTA_RUNTIME: v }),
        },
      }
    );
  }

  console.log(
    `\nГотово: ${versions.length} публікацій.\n` +
      `Не забудьте STAFF_OTA_COMMIT = ${git(["rev-parse", "--short", "HEAD"])} у src/lib/app-builds.ts.`
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
