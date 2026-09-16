/**
 * PDF із набору даних: заголовок, підсумок, таблиця, примітки.
 *
 * pdfmake 0.3 на сервері — зі справжніми TTF із самого пакета (Roboto має
 * всю українську абетку). Віртуальна файлова система шрифтів у 0.3 — лише
 * для браузера. Шрифти читаються з node_modules/pdfmake/fonts за шляхом,
 * тому next.config.ts дописує їх у трасування роуту, що веде хід помічника:
 * без цього збірка Vercel їх не бачить, і PDF падає лише на проді.
 *
 * Знака «₴» у Roboto немає — у PDF він став би порожнім квадратом, тож
 * гривня пишеться словом «грн».
 */

import path from "node:path";
import type { ExportDataset, ExportColumn } from "@/lib/assistant/exports/types";
import { PDF_MAX_ROWS } from "@/lib/assistant/exports/types";

const FONT_DIR = path.join(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto");

const moneyFmt = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const intFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
const priceFmt = new Intl.NumberFormat("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decFmt = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 1 });

const clean = (text: string) => text.replace(/₴/g, "грн");

function cell(value: string | number | null | undefined, col: ExportColumn): string {
  if (value == null || value === "") return "";
  if (typeof value === "number") {
    // Ціна одиниці — з копійками, сума — без: «12,47» проти «7 684».
    if (col.kind === "price") return priceFmt.format(value);
    if (col.kind === "money") return moneyFmt.format(value);
    if (col.kind === "percent") return `${decFmt.format(value)} %`;
    if (col.kind === "decimal") return decFmt.format(value);
    return intFmt.format(value);
  }
  return clean(value);
}

type PdfMake = {
  addFonts(fonts: Record<string, Record<string, string>>): void;
  setUrlAccessPolicy(cb: (url: string) => boolean): void;
  setLocalAccessPolicy(cb: (path: string) => boolean): void;
  createPdf(doc: Record<string, unknown>): { getBuffer(): Promise<Buffer> };
};

let ready: PdfMake | null = null;

async function engine(): Promise<PdfMake> {
  if (ready) return ready;
  const mod = (await import("pdfmake")) as unknown as { default?: PdfMake } & PdfMake;
  const pdfmake = mod.default ?? mod;
  pdfmake.addFonts({
    Roboto: {
      normal: path.join(FONT_DIR, "Roboto-Regular.ttf"),
      bold: path.join(FONT_DIR, "Roboto-Medium.ttf"),
      italics: path.join(FONT_DIR, "Roboto-Italic.ttf"),
      bolditalics: path.join(FONT_DIR, "Roboto-MediumItalic.ttf"),
    },
  });
  // Документ збирається з наших даних: ні мережі, ні чужих файлів йому не треба.
  pdfmake.setUrlAccessPolicy(() => false);
  pdfmake.setLocalAccessPolicy((p) => path.resolve(p).startsWith(FONT_DIR));
  ready = pdfmake;
  return pdfmake;
}

export async function buildPdf(dataset: ExportDataset): Promise<Buffer> {
  const pdfmake = await engine();
  const content: unknown[] = [
    { text: clean(dataset.title), style: "title" },
    { text: clean(dataset.subtitle), style: "subtitle" },
    { text: clean(dataset.summary.join("  ·  ")), style: "summary" },
  ];

  let widest = 0;
  for (const full of dataset.sheets) {
    const sheet = { ...full, columns: full.columns.filter((c) => c.pdf !== false) };
    widest = Math.max(widest, sheet.columns.length);
    const rows = sheet.rows.slice(0, PDF_MAX_ROWS);
    const numeric = (c: ExportColumn) => c.kind && c.kind !== "text" && c.kind !== "date";

    if (dataset.sheets.length > 1) content.push({ text: clean(sheet.name), style: "sheet" });
    content.push({
      table: {
        headerRows: 1,
        // Найширша текстова колонка тягнеться, решта — за вмістом.
        widths: sheet.columns.map((c, i) =>
          c.kind === "text" || !c.kind ? (i === sheet.columns.findIndex((x) => !x.kind || x.kind === "text") ? "*" : "auto") : "auto"
        ),
        body: [
          // Однослівний заголовок не переносимо: «Бренд» інакше ламався на «Брен / д».
          sheet.columns.map((c) => ({ text: clean(c.header), style: "th", noWrap: !/\s/.test(c.header) })),
          ...rows.map((row, i) => {
            const tone = sheet.tones?.[i];
            const fill = tone === "urgent" ? "#FDECEC" : tone === "warn" ? "#FFF6D6" : undefined;
            return sheet.columns.map((c) => ({
              text: cell(row[c.key], c),
              alignment: numeric(c) ? "right" : "left",
              ...(fill ? { fillColor: fill } : {}),
            }));
          }),
        ],
      },
      layout: {
        hLineWidth: (i: number) => (i === 1 ? 0.8 : 0.3),
        vLineWidth: () => 0,
        hLineColor: () => "#D9D9D6",
        paddingTop: () => 2.5,
        paddingBottom: () => 2.5,
      },
      style: "table",
    });
    if (sheet.rows.length > PDF_MAX_ROWS) {
      content.push({
        text: `Показано перші ${PDF_MAX_ROWS} рядків із ${sheet.rows.length}. Повний список — у файлі Excel.`,
        style: "note",
      });
    }
  }

  for (const note of dataset.notes) content.push({ text: clean(note), style: "note" });

  const doc = {
    pageSize: "A4",
    pageOrientation: widest > 6 ? "landscape" : "portrait",
    pageMargins: [28, 32, 28, 36],
    info: { title: clean(dataset.title), creator: "Budvik" },
    defaultStyle: { font: "Roboto", fontSize: widest > 9 ? 7 : 8, color: "#1A1A18" },
    footer: (page: number, pages: number) => ({
      text: `${clean(dataset.title)} · ${page}/${pages}`,
      alignment: "right",
      fontSize: 7,
      color: "#8A8F98",
      margin: [28, 12, 28, 0],
    }),
    content,
    styles: {
      title: { fontSize: 15, bold: true, margin: [0, 0, 0, 2] },
      subtitle: { fontSize: 9, color: "#5B6068", margin: [0, 0, 0, 8] },
      summary: { fontSize: 9, bold: true, margin: [0, 0, 0, 2] },
      sheet: { fontSize: 11, bold: true, margin: [0, 10, 0, 4] },
      table: { margin: [0, 8, 0, 6] },
      th: { bold: true, fillColor: "#2F5496", color: "#FFFFFF" },
      note: { fontSize: 7.5, italics: true, color: "#5B6068", margin: [0, 4, 0, 0] },
    },
  };

  return pdfmake.createPdf(doc).getBuffer();
}
