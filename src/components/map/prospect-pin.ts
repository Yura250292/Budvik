/**
 * Імпортована точка для розпрацювання — спільне для карти керівника
 * (ClientMap) і карти торгового (SalesClientsMap): одна форма й один опис,
 * щоб «малиновий ромб» означав те саме на обох екранах.
 */

import L from "leaflet";
import { PROSPECT_IMPORT } from "@/lib/analytics/colors";

/** Поля джерела імпорту — див. scripts/import-prospects-baza-lviv.mts. */
export type ProspectDetails = {
  category?: string | null;
  specialization?: string | null;
  outletType?: string | null;
  city?: string | null;
  pricePositioning?: string | null;
  /** MANUAL — точку поставила людина на місці або пальцем на карті. */
  precision?: "ADDRESS" | "CITY" | "MANUAL";
  similarClient?: { id: string; name: string; lastSale: string | null } | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Пульсуючий ромб. Затримка кільця береться з id, щоб сусідні точки не
 * спалахували в такт — синхронна пульсація сотень точок рябить в очах.
 * Приблизна точка (знайдено лише населений пункт) — порожниста.
 *
 * `hit` — розмір зони дотику, `size` — видимого ромба. Вони різні навмисно:
 * ромб малий, щоб не накривати клієнтів, а цілитися пальцем треба в щось
 * більше.
 */
export function importedPin(id: string, approx: boolean, size = 9, hit = 16): L.DivIcon {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const delay = ((h % 2600) / 1000).toFixed(2);
  return L.divIcon({
    className: "",
    iconSize: [hit, hit],
    iconAnchor: [hit / 2, hit / 2],
    popupAnchor: [0, -size / 2],
    html: `<div class="prospect-import-pin${approx ? " prospect-import-pin--approx" : ""}"
      style="width:${hit}px;height:${hit}px;--pin-size:${size}px;--pin-color:${PROSPECT_IMPORT.color};--pin-delay:-${delay}s"><span></span></div>`,
  });
}

/**
 * Рядки попапу з даних бланку: категорія (A — найбільший потенціал,
 * D — найменший), спеціалізація, тип точки, точність і схожий контрагент 1С.
 */
export function importedInfoHtml(d: ProspectDetails): string {
  const bits = [
    // У бланку «В» трапляється кирилицею — показуємо однаково латинську.
    d.category ? `категорія ${d.category.replace("В", "B")}` : null,
    d.specialization,
    d.outletType,
    d.pricePositioning,
  ].filter(Boolean) as string[];
  const sim = d.similarClient;
  return [
    bits.length ? `<div style="color:#4B5563;font-size:12px;margin-top:3px">${bits.map(escapeHtml).join(" · ")}</div>` : "",
    d.precision === "CITY"
      ? `<div style="color:#B45309;font-size:11px;margin-top:2px">приблизно: знайдено лише населений пункт</div>`
      : d.precision === "MANUAL"
        ? `<div style="color:#9CA3AF;font-size:11px;margin-top:2px">точку уточнено вручну</div>`
        : "",
    sim
      ? `<div style="color:#6B7280;font-size:11px;margin-top:2px">у 1С схожий: ${escapeHtml(sim.name)}${
          sim.lastSale
            ? ` · остання покупка ${escapeHtml(sim.lastSale.split("-").reverse().join("."))}`
            : " · покупок немає"
        }</div>`
      : "",
  ].join("");
}

/** Масштаб, з якого імпортовані точки пульсують (див. .prospects-far). */
// 13 — вуличний масштаб: там торговий шукає конкретний магазин, і рух
// допомагає. На огляді міста чи області пульс сотень точок лише рябить.
export const PROSPECT_NEAR_ZOOM = 13;

/** Перемикає «огляд/зблизька» на контейнері карти за поточним масштабом. */
export function syncProspectZoom(map: L.Map) {
  map.getContainer().classList.toggle("prospects-far", map.getZoom() < PROSPECT_NEAR_ZOOM);
}
