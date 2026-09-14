/**
 * Аудіо наради в R2: які файли приймаємо і під яким ключем кладемо.
 *
 * Чистий модуль (читає й форма завантаження). Бакет публічний через
 * R2_PUBLIC_URL — там фото товарів, — тож ключ запису навмисно невгадуваний, а
 * публічна адреса ніде не зберігається й не віддається: слухають через
 * підписане посилання (/api/admin/meetings/[id]/audio).
 */

/** 300 МБ — понад дев'ять годин навіть при 64 кбіт/с; більшого на нараді не буває. */
export const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

/**
 * Розширення, які дає диктофон телефона чи месенджер.
 *
 * Список із Metrum, де його набирали по скаргах: m4a з айфона, amr і 3gp зі
 * старих андроїдів, opus із Telegram.
 */
export const AUDIO_EXTENSIONS = [
  "mp3",
  "mp4",
  "m4a",
  "mpeg",
  "mpga",
  "wav",
  "webm",
  "ogg",
  "oga",
  "flac",
  "aac",
  "opus",
  "amr",
  "3gp",
] as const;

/** Для атрибута accept у виборі файлу. */
export const AUDIO_ACCEPT = ["audio/*", "video/mp4", "video/webm", "video/3gpp", ...AUDIO_EXTENSIONS.map((e) => `.${e}`)].join(",");

function extOf(fileName: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(fileName.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Чи це аудіо.
 *
 * Телефони позначають m4a як video/mp4, а файл із месенджера приходить як
 * application/octet-stream — тому MIME не єдиний суддя, дивимось і на
 * розширення.
 */
export function isAcceptableAudio(contentType: string, fileName: string): boolean {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  if (mime.startsWith("audio/")) return true;
  if (mime === "video/mp4" || mime === "video/webm" || mime === "video/3gpp") return true;
  return (AUDIO_EXTENSIONS as readonly string[]).includes(extOf(fileName));
}

/** Розширення для ключа: з назви файлу, а без неї — з MIME. */
export function extensionFor(fileName: string, contentType: string): string {
  const fromName = extOf(fileName);
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(fromName)) return fromName;
  const mime = contentType.toLowerCase();
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "bin";
}

export function meetingKeyPrefix(meetingId: string): string {
  return `meetings/${meetingId}/`;
}

/** meetings/<id>/<ts>-<uuid>.<ext> */
export function audioKey(meetingId: string, fileName: string, contentType: string): string {
  const rand = globalThis.crypto.randomUUID();
  return `${meetingKeyPrefix(meetingId)}${Date.now()}-${rand}.${extensionFor(fileName, contentType)}`;
}

/** Ключ справді цієї наради — щоб у complete-upload не підсунули чужий об'єкт. */
export function isMeetingKey(meetingId: string, key: string): boolean {
  return key.startsWith(meetingKeyPrefix(meetingId)) && !key.includes("..") && !key.includes("//");
}

/** Обрізає MIME до форми, яку приймає підпис R2: без параметрів і пробілів. */
export function normalizeContentType(contentType: string): string {
  const mime = contentType.toLowerCase().split(";")[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : "application/octet-stream";
}
