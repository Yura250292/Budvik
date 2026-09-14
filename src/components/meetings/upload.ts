"use client";

import { sendJson } from "./api";

/**
 * Завантаження запису наради: посилання від сервера → PUT прямо в R2 → «готово».
 *
 * Через функцію Vercel файл не йде (ліміт тіла 4,5 МБ). XHR, а не fetch, бо
 * лише він дає прогрес відвантаження — година запису на слабкому мобільному
 * інтернеті це хвилини, і без смужки людина закриває вкладку.
 */

export type UploadStage = "preparing" | "uploading" | "finishing";

const TYPE_BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  mp3: "audio/mpeg",
  mpeg: "audio/mpeg",
  mpga: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  amr: "audio/amr",
  "3gp": "audio/3gpp",
};

/** Файл з месенджера приходить без типу — угадуємо з розширення. */
function contentTypeFor(fileName: string, type: string): string {
  if (type) return type;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return TYPE_BY_EXT[ext] ?? "application/octet-stream";
}

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

function put(url: string, blob: Blob, contentType: string, onProgress: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onProgress(Math.round((ev.loaded / ev.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new HttpError(`Сховище не прийняло файл (${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new HttpError("Файл не дійшов до сховища — перевірте зв'язок", 0));
    xhr.send(blob);
  });
}

/**
 * Обидва службові виклики безпечні для повтору: upload-url просто видає нове
 * посилання для чернетки, complete-upload на вже завершеному нічого не міняє.
 */
function postJson<T>(url: string, body: unknown): Promise<T> {
  return sendJson<T>(url, "POST", body, { retry: true });
}

export async function uploadMeetingAudio(opts: {
  meetingId: string;
  blob: Blob;
  fileName: string;
  durationMs?: number | null;
  onStage?: (stage: UploadStage) => void;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const { meetingId, blob, fileName } = opts;
  opts.onStage?.("preparing");

  const prep = await postJson<{ uploadUrl: string; key: string; contentType: string }>(
    `/api/admin/meetings/${meetingId}/upload-url`,
    { fileName, contentType: contentTypeFor(fileName, blob.type), size: blob.size }
  );

  opts.onStage?.("uploading");
  const progress = (p: number) => opts.onProgress?.(p);
  try {
    await put(prep.uploadUrl, blob, prep.contentType, progress);
  } catch (e) {
    // Обрив мережі — один повтор тим самим посиланням (воно живе годину).
    // Відмову сховища (403, 400) повтор не вилікує.
    if (!(e instanceof HttpError) || e.status !== 0) throw e;
    await new Promise((r) => setTimeout(r, 1500));
    await put(prep.uploadUrl, blob, prep.contentType, progress);
  }

  opts.onStage?.("finishing");
  await postJson(`/api/admin/meetings/${meetingId}/complete-upload`, {
    key: prep.key,
    durationMs: opts.durationMs ?? null,
  });
}
