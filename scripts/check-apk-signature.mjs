/**
 * Хто підписав APK — з криптографічною перевіркою, а не «на око».
 *
 * Запуск:
 *   node scripts/check-apk-signature.mjs assets/app/BudvikTracker.apk
 *
 * Навіщо. Ключ підпису вирішує, чи встановиться оновлення поверх наявної
 * збірки: інший ключ означає «чужий пакет», і людина мусить спершу знести
 * стару версію. Помітити це на релізі — вже пізно.
 *
 * Штатні інструменти для такої перевірки — apksigner і keytool, обидва
 * потребують Java, якої на машині немає. Тому розбір робиться тут.
 *
 * І головне, чому це не просто «дістати сертифікат»: неправильний зсув
 * дає цілком правдоподібний сертифікат, який спокійно розбирається і має
 * розумну дату. Саме на цьому вже обпеклися в сусідньому проєкті —
 * саморобний розбір показав три різні ключі там, де ключ був один.
 * Тому нижче перевіряється не структура, а підпис: чи цей ключ справді
 * підписав ці байти. Якщо ні — сертифікат не той, хоч би як добре він
 * виглядав.
 */

import { readFileSync } from "fs";
import { createVerify, createHash, createPublicKey, X509Certificate } from "crypto";

const file = process.argv[2];
if (!file) {
  console.error("Вкажіть шлях до APK");
  process.exit(1);
}

const data = readFileSync(file);
const u32 = (buf, off) => buf.readUInt32LE(off);

/** Ідентифікатори блоків у службовому блоці APK. */
const V2 = 0x7109871a;
const V3 = 0xf05368c0;

/**
 * Службовий блок лежить одразу перед центральним каталогом ZIP і
 * закінчується магічним рядком — від нього й відштовхуємось.
 */
function signingBlocks(apk) {
  const eocd = apk.lastIndexOf(Buffer.from("PK\x05\x06", "binary"));
  if (eocd < 0) throw new Error("це не ZIP: кінця каталогу немає");

  const cd = u32(apk, eocd + 16);
  if (apk.subarray(cd - 16, cd).toString("latin1") !== "APK Sig Block 42") {
    throw new Error("блоку підпису немає — APK підписаний лише за схемою v1?");
  }

  const size = Number(apk.readBigUInt64LE(cd - 24));
  const end = cd - 24;
  const blocks = new Map();

  let off = cd - size - 8 + 8;
  while (off + 12 <= end) {
    const len = Number(apk.readBigUInt64LE(off));
    if (len < 4 || off + 8 + len > end + 24) break;
    blocks.set(u32(apk, off + 8), apk.subarray(off + 12, off + 8 + len));
    off += 8 + len;
  }
  return blocks;
}

/**
 * Розбирає одного підписанта.
 *
 * Формат — вкладені послідовності з 4-байтовими префіксами довжини.
 * Найпідступніше місце: елементи послідовності підписів САМІ мають
 * префікс довжини, і помилка на ці чотири байти дає «алгоритм»,
 * підозріло схожий на розмір підпису (0x108 = 264 = 256 байтів RSA + 8).
 */
function parseSigner(block) {
  const signer = block.subarray(4 + 4, 4 + u32(block, 0));

  const signedDataLen = u32(signer, 0);
  const signedData = signer.subarray(4, 4 + signedDataLen);

  let p = 4 + signedDataLen;
  const sigsLen = u32(signer, p);
  const sigs = signer.subarray(p + 4, p + 4 + sigsLen);
  p += 4 + sigsLen;
  const publicKey = signer.subarray(p + 4, p + 4 + u32(signer, p));

  // Сертифікат — у складі підписаних даних, після переліку дайджестів.
  const certsOff = 4 + u32(signedData, 0);
  const certLen = u32(signedData, certsOff + 4);
  const certificate = signedData.subarray(certsOff + 8, certsOff + 8 + certLen);

  const algo = u32(sigs, 4);
  const sigLen = u32(sigs, 8);
  const signature = sigs.subarray(12, 12 + sigLen);

  return { signedData, signature, publicKey, certificate, algo };
}

/** Ідентифікатори з документації схеми підпису APK. */
const ALGOS = {
  0x0101: { hash: "sha256", padding: "pss" },
  0x0102: { hash: "sha512", padding: "pss" },
  0x0103: { hash: "sha256", padding: "pkcs1" },
  0x0104: { hash: "sha512", padding: "pkcs1" },
  0x0201: { hash: "sha256", padding: "ec" },
  0x0202: { hash: "sha512", padding: "ec" },
  0x0301: { hash: "sha256", padding: "dsa" },
};

function check(signer) {
  const spec = ALGOS[signer.algo];
  if (!spec) {
    console.log(`  ✗ невідомий алгоритм ${signer.algo.toString(16)}`);
    return false;
  }

  const key = createPublicKey({ key: signer.publicKey, format: "der", type: "spki" });

  const verifier = createVerify(spec.hash);
  verifier.update(signer.signedData);
  const opts =
    spec.padding === "pss"
      ? { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: -1 }
      : key;
  const valid = verifier.verify(opts, signer.signature);

  /**
   * Ключ у сертифікаті й ключ підписанта лежать у різних місцях структури.
   * Якщо вони збігаються — розбір майже напевно правильний; якщо ні —
   * читали не те, навіть коли обидва «виглядають» як ключі.
   */
  const cert = new X509Certificate(signer.certificate);
  const sameKey = cert.publicKey
    .export({ type: "spki", format: "der" })
    .equals(signer.publicKey);

  const fingerprint = createHash("sha256")
    .update(signer.certificate)
    .digest("hex")
    .toUpperCase()
    .match(/../g)
    .join(":");

  console.log(`  алгоритм: ${spec.hash}/${spec.padding}`);
  console.log(`  ключ сертифіката = ключ підписанта: ${sameKey ? "так ✓" : "НІ ✗"}`);
  console.log(`  підпис над підписаними даними: ${valid ? "СХОДИТЬСЯ ✓" : "НЕ СХОДИТЬСЯ ✗"}`);
  console.log(`  SHA-256 сертифіката: ${fingerprint}`);
  console.log(`  дійсний до: ${cert.validTo}`);
  return valid && sameKey;
}

let failed = 0;
console.log(`\n${file}\n`);

const blocks = signingBlocks(data);
const present = [...blocks.keys()]
  .map((b) => (b === V2 ? "v2" : b === V3 ? "v3" : null))
  .filter(Boolean);
console.log("схеми підпису:", present.join(", ") || "немає");

for (const [id, label] of [
  [V2, "v2"],
  [V3, "v3"],
]) {
  if (!blocks.has(id)) continue;
  console.log(`\n${label}:`);
  if (!check(parseSigner(blocks.get(id)))) failed++;
}

console.log(
  failed === 0
    ? "\nПідпис підтверджено: цей ключ справді підписав цей файл.\n"
    : "\nПІДПИС НЕ ПІДТВЕРДЖЕНО — не роздавайте цю збірку.\n"
);
process.exitCode = failed === 0 ? 0 : 1;
