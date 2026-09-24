/**
 * Перевірка точки клієнта через інтернет: чи стоїть вона там, куди веде
 * адреса.
 *
 * Два запити до OpenStreetMap (Nominatim) на клієнта: що насправді лежить у
 * місці збереженої точки (reverse) і де знаходиться адреса з картки
 * (lookupAddress — лише Україна, без «глобальних» стратегій, через які
 * «Торпедо» колись опинився під Запоріжжям). Висновок — pinVerdict.
 *
 * Нічого не пише: точку пересуває людина на екрані уточнення (посилання у
 * відповіді). Точка, поставлена людиною на місці, важить більше за
 * геокодер — розбіжність із нею означає скоріше стару адресу в 1С.
 *
 * Nominatim пускає запит раз на ~1,1 с, тож на клієнта йде 2–4 с; звідси
 * стеля PIN_CHECK_MAX за виклик.
 */

import { buildQuery, runInReadOnlyTx } from "@/lib/assistant/facts/query-db";
import { pinVerdict, type PinVerdictCode } from "@/lib/assistant/facts/client-geo";
import { inLvivOblast } from "@/lib/geo/lviv-oblast";
import { lookupAddress, reverseGeocode, type AddressPrecision } from "@/lib/geo/nominatim";

export const PIN_CHECK_MAX = 3;

/** Рядок виду client_geo — те, що про точку вже знає база. */
export type ClientGeoRow = {
  client_id: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  pin_source: string;
  pinned_by: string | null;
  pinned_day: string | null;
  accuracy_m: number | null;
  region: "LVIV" | "OUTSIDE" | null;
  shipping_only: boolean | null;
  np_branch: boolean;
  heap: number | null;
  suspect: boolean;
  suspect_reason: string | null;
  map_url: string | null;
};

const ID_RE = /^[a-z0-9]{10,40}$/i;

/**
 * Точки клієнтів з виду client_geo — тим самим SQL, що бачить query_db, але
 * без його форматування рядків для моделі: там адреса обрізається до 160
 * символів, а в Nominatim вона має піти цілою.
 */
export async function clientGeoRows(ids: string[]): Promise<Map<string, ClientGeoRow>> {
  const safe = [...new Set(ids.filter((id) => ID_RE.test(id)))];
  if (safe.length === 0) return new Map();
  const sql = `SELECT client_id, name, address, lat, lng, pin_source, pinned_by, pinned_day, accuracy_m, region,
            shipping_only, np_branch, heap, suspect, suspect_reason, map_url
     FROM client_geo WHERE client_id IN (${safe.map((id) => `'${id}'`).join(", ")})`;
  const rows = await runInReadOnlyTx<Omit<ClientGeoRow, "pinned_day"> & { pinned_day: Date | string | null }>(
    buildQuery(sql, ["client_geo"], safe.length),
    15_000
  );
  return new Map(
    rows.map((r) => [
      r.client_id,
      {
        ...r,
        lat: num(r.lat),
        lng: num(r.lng),
        heap: num(r.heap),
        accuracy_m: num(r.accuracy_m),
        pinned_day: r.pinned_day instanceof Date ? r.pinned_day.toISOString().slice(0, 10) : r.pinned_day,
      },
    ])
  );
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export type PinCheck = {
  row: ClientGeoRow;
  /** Що OpenStreetMap бачить у місці точки. */
  atPin: string | null;
  /** Де адреса з картки за OpenStreetMap. */
  found: { lat: number; lng: number; displayName: string; precision: AddressPrecision; query: string; region: "LVIV" | "OUTSIDE" } | null;
  verdict: { code: PinVerdictCode; km: number | null; text: string };
};

export async function checkClientPin(row: ClientGeoRow): Promise<PinCheck> {
  const pin = row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null;
  const at = pin ? await reverseGeocode(pin.lat, pin.lng).catch(() => null) : null;
  const hit = row.address ? await lookupAddress(row.address).catch(() => null) : null;
  const found = hit ? { ...hit, region: inLvivOblast(hit.lat, hit.lng) ? ("LVIV" as const) : ("OUTSIDE" as const) } : null;
  return {
    row,
    atPin: at?.displayName ?? null,
    found,
    verdict: pinVerdict({ hasAddress: !!row.address, pinSource: row.pin_source, pin, found }),
  };
}

/** Google Maps на точку — щоб людина глянула очима. */
export function mapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
