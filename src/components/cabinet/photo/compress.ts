"use client";

/**
 * Стиснення знімка в браузері перед відправкою.
 *
 * Винесено з ClientCommentsModal, коли те саме знадобилось чату: дві копії
 * розійшлися б на першій правці, а тут кожен рядок оплачений поламкою на
 * живому планшеті (див. коментар про close() нижче).
 */

/** Довша сторона знімка після стиснення, px. */
export const MAX_SIDE = 1600;

export type Shot = { file: File; width: number; height: number };

/**
 * Телефон віддає 3-5 МБ на кадр, а по дорозі в село це хвилина очікування
 * і обірваний запит. 1600 px по довшій стороні вистачає, щоб роздивитися
 * ворота й вивіску, і дає файл на кілька сотень кілобайт.
 *
 * Якщо щось пішло не так (браузер не дав canvas, екзотичний формат) —
 * повертаємо оригінал: краще повільно, ніж ніяк. Розміри при цьому можуть
 * лишитись нульовими, і це чесно: ми їх не дізналися.
 */
export async function compress(file: File, name = "photo.jpg"): Promise<Shot> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { file, width: bitmap.width, height: bitmap.height };
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
    // Полотно теж тримає пам'ять: 1600×1200 — це ще 7 МБ, які на планшеті
    // з двома гігабайтами не зайві. Обнуляємо розмір, щоб браузер віддав їх
    // одразу, а не коли надумає.
    canvas.width = 0;
    canvas.height = 0;
    if (!blob || blob.size >= file.size) return { file, width: bitmap.width, height: bitmap.height };
    return { file: new File([blob], name, { type: "image/jpeg" }), width: w, height: h };
  } catch {
    return { file, width: 0, height: 0 };
  } finally {
    /**
     * Закривати ОБОВ'ЯЗКОВО і на всіх шляхах.
     *
     * Розпакований кадр із планшетної камери — це 4000×3000×4 байти, тобто
     * 48 МБ у пам'яті вкладки. Раніше close() стояв лише на вдалій гілці:
     * кожне скасування чи екзотичний формат лишали ці 48 МБ висіти до
     * прибирача. Кілька спроб поспіль — і рендерер WebView просто вбивали
     * за пам'ять, а для людини це «застосунок завис».
     */
    bitmap?.close();
  }
}
