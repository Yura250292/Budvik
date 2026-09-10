/**
 * Тип зображення за першими байтами файлу.
 *
 * Спільний для аватарів і фото в чаті: обидва приймають файл сирим тілом,
 * і обом потрібно знати, що це насправді, не питаючи клієнта.
 */

/**
 * Формат — за першими байтами, а не за словом клієнта.
 *
 * Заголовок від клієнта тут ненадійний двічі: Android віддає порожній тип
 * для HEIC з галереї (файл відкидався як «не зображення»), а підставити
 * чуже значення руками може будь-хто. Байти не брешуть в обидва боки.
 */
export function sniffImage(buf: Buffer): { type: string; ext: string } | null {
  if (buf.length < 12) return null;

  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { type: "image/jpeg", ext: "jpg" };
  }
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { type: "image/png", ext: "png" };
  }
  if (
    buf.subarray(0, 4).toString("latin1") === "RIFF" &&
    buf.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return { type: "image/webp", ext: "webp" };
  }
  // HEIC/HEIF: тип лежить у брендi контейнера ISO-BMFF одразу після "ftyp".
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = buf.subarray(8, 12).toString("latin1");
    if (/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(brand)) {
      return { type: "image/heic", ext: "heic" };
    }
  }

  return null;
}
