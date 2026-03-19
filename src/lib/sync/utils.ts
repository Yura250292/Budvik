import iconv from "iconv-lite";
import * as XLSX from "xlsx";

/** Parse a CSV line handling quoted fields */
export function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/**
 * Detect encoding and convert file content to UTF-8 string.
 * 1C typically exports in Windows-1251 (Cyrillic).
 * We detect by checking for UTF-8 BOM or valid UTF-8 sequences.
 */
export function decodeFileContent(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  // Check for UTF-8 BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(buffer);
  }

  // Try UTF-8 first — if it has Cyrillic-looking bytes (0x80-0xFF) that
  // don't form valid UTF-8 sequences, it's likely Windows-1251
  const text = new TextDecoder("utf-8").decode(buffer);

  // Heuristic: if replacement character (U+FFFD) appears, likely not UTF-8
  if (text.includes("\ufffd")) {
    return iconv.decode(Buffer.from(bytes), "windows-1251");
  }

  // Another heuristic: check if high bytes appear without valid UTF-8 multibyte prefix
  let hasHighBytes = false;
  let looksLikeUtf8 = true;
  for (let i = 0; i < Math.min(bytes.length, 4096); i++) {
    if (bytes[i] >= 0x80) {
      hasHighBytes = true;
      // Valid UTF-8 multibyte: 110xxxxx 10xxxxxx, 1110xxxx 10xxxxxx 10xxxxxx, etc.
      if (bytes[i] >= 0xc0 && bytes[i] < 0xfe) {
        const expected = bytes[i] < 0xe0 ? 1 : bytes[i] < 0xf0 ? 2 : 3;
        for (let j = 1; j <= expected; j++) {
          if (i + j >= bytes.length || (bytes[i + j] & 0xc0) !== 0x80) {
            looksLikeUtf8 = false;
            break;
          }
        }
        if (!looksLikeUtf8) break;
        i += bytes[i] < 0xe0 ? 1 : bytes[i] < 0xf0 ? 2 : 3;
      } else if ((bytes[i] & 0xc0) === 0x80) {
        // Continuation byte without start byte — not UTF-8
        looksLikeUtf8 = false;
        break;
      }
    }
  }

  if (hasHighBytes && !looksLikeUtf8) {
    return iconv.decode(Buffer.from(bytes), "windows-1251");
  }

  return text;
}

/**
 * Find the header row in a 1C report CSV.
 * 1C reports have metadata lines at the top (report name, period, filters).
 * The actual header row contains column names.
 * Returns the index of the header line and the remaining data lines.
 */
export function findDataStart(
  lines: string[],
  headerPatterns: string[]
): { headerIdx: number; headers: string[]; sep: string } | null {
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const sep = line.includes(";") ? ";" : ",";
    const cols = line.split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());

    // Check if any of the header patterns match any column
    const matchCount = headerPatterns.filter((p) =>
      cols.some((c) => c.includes(p))
    ).length;

    if (matchCount >= 2) {
      return { headerIdx: i, headers: cols, sep };
    }
  }
  return null;
}

/**
 * Convert XLSX/XLS file buffer to CSV string (semicolon-separated).
 * Returns the CSV text that can be parsed by existing CSV parsers.
 */
export function xlsxToCSV(buffer: ArrayBuffer): string {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(ws, { FS: ";" });
}

/**
 * Decode any file: XLSX → CSV string, or CSV/TXT → decoded string.
 */
export function decodeAnyFile(buffer: ArrayBuffer, fileName: string): string {
  const ext = fileName.toLowerCase();
  if (ext.endsWith(".xlsx") || ext.endsWith(".xls")) {
    return xlsxToCSV(buffer);
  }
  return decodeFileContent(buffer);
}
