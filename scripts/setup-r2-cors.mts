/**
 * CORS бакета R2 під пряме завантаження аудіо нарад із браузера.
 *
 *   npx tsx --env-file=.env scripts/setup-r2-cors.mts                       # показати чинні правила й те, що буде
 *   npx tsx --env-file=.env scripts/setup-r2-cors.mts --apply               # записати
 *   npx tsx --env-file=.env scripts/setup-r2-cors.mts --apply --origin https://budvik-xyz.vercel.app
 *
 * Навіщо. Браузер кладе запис наради в R2 сам, за підписаним посиланням
 * (src/lib/r2.ts presignedPutUrl), і перед PUT шле preflight. Без правила
 * CORS бакет його відхиляє, і завантаження падає «R2 upload error» без
 * жодного пояснення.
 *
 * PutBucketCors замінює конфігурацію ЦІЛКОМ. Тому чинні правила зчитуються й
 * лишаються, а наше (PUT з наших адрес) додається чи замінює попереднє наше.
 * Саме правило нічого не відкриває: записати в бакет однаково можна лише за
 * підписаним посиланням, яке видає роут після перевірки доступу.
 */
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client, type CORSRule } from "@aws-sdk/client-s3";

const has = (name: string) => process.argv.includes(`--${name}`);
const extraOrigins = process.argv.flatMap((a, i, all) => (a === "--origin" && all[i + 1] ? [all[i + 1]] : []));

const bucket = process.env.R2_BUCKET_NAME;
if (!bucket || !process.env.R2_ACCOUNT_ID) throw new Error("Немає R2_BUCKET_NAME / R2_ACCOUNT_ID у середовищі");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
});

const OUR_ORIGINS = ["https://www.budvik27.com", "https://budvik27.com", "http://localhost:3000", ...extraOrigins];

const ours: CORSRule = {
  AllowedOrigins: OUR_ORIGINS,
  AllowedMethods: ["PUT", "GET", "HEAD"],
  AllowedHeaders: ["content-type"],
  ExposeHeaders: ["ETag"],
  MaxAgeSeconds: 3600,
};

let current: CORSRule[] = [];
try {
  const res = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
  current = res.CORSRules ?? [];
} catch (e) {
  const name = (e as { name?: string }).name;
  if (name !== "NoSuchCORSConfiguration") throw e;
}

const describe = (r: CORSRule) =>
  `${r.AllowedMethods?.join(",")} ← ${r.AllowedOrigins?.join(", ")} · заголовки: ${r.AllowedHeaders?.join(", ") || "—"}`;

console.log(`бакет ${bucket}, чинних правил: ${current.length}`);
for (const r of current) console.log(`  ${describe(r)}`);

/**
 * Чи вже можна PUT з цього джерела з заголовком Content-Type.
 *
 * Чинні правила НІКОЛИ не замінюємо і не звужуємо: 14.09.2026 у бакеті вже
 * стояло ширше правило (GET, HEAD, PUT, POST, DELETE) для сайту, і заміна
 * «нашим» вужчим мовчки відрізала б POST і DELETE тому, хто на них спирається.
 */
const allowsPut = (origin: string) =>
  current.some(
    (r) =>
      !!r.AllowedMethods?.includes("PUT") &&
      !!(r.AllowedOrigins?.includes(origin) || r.AllowedOrigins?.includes("*")) &&
      !!r.AllowedHeaders?.some((h) => h === "*" || h.toLowerCase() === "content-type")
  );

const uncovered = OUR_ORIGINS.filter((o) => !allowsPut(o));
if (uncovered.length === 0) {
  console.log("\nPUT з Content-Type уже дозволено з усіх потрібних адрес — нічого змінювати не треба.");
} else {
  const next = [...current, { ...ours, AllowedOrigins: uncovered }];
  console.log(`\nбракує PUT для: ${uncovered.join(", ")}. Буде додано правило (чинні лишаються як є):`);
  for (const r of next) console.log(`  ${describe(r)}`);

  if (!has("apply")) {
    console.log("\ndry — нічого не записано. Додайте --apply.");
  } else {
    await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: next } }));
    console.log("\nзаписано.");
  }
}
