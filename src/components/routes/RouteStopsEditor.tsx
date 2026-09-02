"use client";

/**
 * Ручне коригування точок маршруту.
 *
 * Три речі, яких раніше не було взагалі: прибрати точку, додати точку
 * (замовленням, клієнтом із бази або бонусною поїздкою) і перемкнути зону
 * оплати.
 *
 * Клієнт із бази — окремий вид точки: маршрут часто складають ще до
 * накладних, по пам'яті («Коваль у Жовтанцях»). Якщо в такого клієнта немає
 * координати взагалі, карта відкривається одразу: виправити пін тут коштує
 * один клік, а водієві на трасі — півгодини.
 *
 * Порядок міняється стрілками, а не перетягуванням: логіст працює і з
 * ноутбука, і з планшета в цеху, а drag-n-drop на тачскріні всередині
 * прокручуваного списку конфліктує зі скролом сторінки — та сама причина,
 * через яку в картах довелося прибрати contain.
 */

import { useState } from "react";
import { formatPrice } from "@/lib/utils";
import StopPinModal from "@/components/routes/StopPinModal";
import ClientSearch, { pinUnusable, type FoundClient } from "@/components/routes/ClientSearch";
import { appendMissing } from "@/lib/routes/order";

type Stop = {
  id: string;
  sequence: number;
  kind: "DELIVERY" | "PICKUP" | "ERRAND";
  title: string | null;
  address: string | null;
  status: string;
  payOverride: number | null;
  zoneOverride: "CITY" | "OBLAST" | null;
  notes: string | null;
  /** Власна координата точки — є лише в поїздок без контрагента. */
  lat?: number | null;
  lng?: number | null;
  counterparty?: {
    id: string;
    name: string;
    deliveryLat?: number | null;
    deliveryLng?: number | null;
    geoSource?: string | null;
  } | null;
  salesDocument?: { id: string; number: string; totalAmount: number } | null;
};

type Order = {
  id: string;
  number: string;
  totalAmount: number;
  counterparty?: { name: string } | null;
};

const KIND_LABEL: Record<Stop["kind"], string> = {
  DELIVERY: "Доставка",
  PICKUP: "Забрати",
  ERRAND: "Доручення",
};

const KIND_ICON: Record<Stop["kind"], string> = {
  DELIVERY: "📦",
  PICKUP: "↩️",
  ERRAND: "✳️",
};

export default function RouteStopsEditor({
  routeId,
  stops,
  editable,
  availableOrders,
  onChanged,
  previewOrder,
}: {
  routeId: string;
  stops: Stop[];
  /** false — водій уже в дорозі або маршрут закритий: тільки перегляд */
  editable: boolean;
  availableOrders: Order[];
  onChanged: () => void;
  /**
   * Непідтверджений порядок з «Прокласти маршрут»: id точок так, як їх
   * пропонує обраний варіант. Список перебудовується одразу, ще до
   * збереження, і саме його нумерацію повторюють піни на карті.
   */
  previewOrder?: string[] | null;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | "order" | "client" | "errand">(null);
  // Ціль модалки піна — не сама точка, а клієнт: координата живе в його
  // картці. Так у карту можна відкрити й того, кого щойно знайшли пошуком
  // і хто ще не став точкою маршруту.
  const [pinTarget, setPinTarget] = useState<PinTarget | null>(null);

  // Форма бонусної поїздки
  const [exKind, setExKind] = useState<"PICKUP" | "ERRAND">("PICKUP");
  const [exTitle, setExTitle] = useState("");
  const [exAddress, setExAddress] = useState("");
  const [exPay, setExPay] = useState("");

  /**
   * Порядок рядків на екрані.
   *
   * Точки, яких у запропонованому порядку немає (наприклад, без
   * координат — вони не їдуть в OSRM), стають у хвіст: рівно так їх
   * перенумерує й збереження. Список і карта мають показувати одне й те
   * саме ще до натискання «Обрати цей».
   */
  const previewing = !!previewOrder?.length;
  const byId = new Map(stops.map((s) => [s.id, s]));
  // Той самий appendMissing, що й у збереженні порядку: список показує
  // рівно те, що ляже в базу після «Обрати цей», а не схожий на нього
  // порядок.
  const shown = previewing
    ? appendMissing(previewOrder!, stops.map((s) => s.id)).map((id) => byId.get(id)!)
    : stops;


  const call = async (
    url: string,
    init: RequestInit,
    tag: string
  ): Promise<boolean> => {
    setBusy(tag);
    setError(null);
    try {
      const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Не вдалося зберегти");
        return false;
      }
      onChanged();
      return true;
    } catch {
      setError("Немає зв'язку — спробуйте ще раз");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const removeStop = async (stop: Stop) => {
    const name = stop.title || stop.counterparty?.name || "точку";
    if (!confirm(`Прибрати ${name} з маршруту?`)) return;
    await call(
      `/api/erp/delivery-routes/stop/${stop.id}`,
      { method: "DELETE" },
      `del:${stop.id}`
    );
  };

  const setZone = async (stop: Stop, zone: "CITY" | "OBLAST" | null) => {
    await call(
      `/api/erp/delivery-routes/stop/${stop.id}`,
      { method: "PATCH", body: JSON.stringify({ zoneOverride: zone }) },
      `zone:${stop.id}`
    );
  };

  /** Обмін порядковими номерами з сусідом — той самий ефект, що перетягування. */
  const move = async (index: number, dir: -1 | 1) => {
    const a = shown[index];
    const b = shown[index + dir];
    if (!a || !b) return;
    await call(
      `/api/erp/delivery-routes/${routeId}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          stopSequences: [
            { stopId: a.id, sequence: b.sequence },
            { stopId: b.id, sequence: a.sequence },
          ],
        }),
      },
      `move:${a.id}`
    );
  };

  const addOrder = async (orderId: string) => {
    const ok = await call(
      `/api/erp/delivery-routes/${routeId}/add-stop`,
      { method: "POST", body: JSON.stringify({ salesDocumentId: orderId }) },
      `add:${orderId}`
    );
    if (ok) setAdding(null);
  };

  const addClient = async (c: FoundClient) => {
    const ok = await call(
      `/api/erp/delivery-routes/${routeId}/add-stop`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "DELIVERY",
          counterpartyId: c.id,
          address: c.address,
        }),
      },
      `add:${c.id}`
    );
    // Точки на карті немає (або вона на центр села) — показуємо карту
    // одразу. Пізніше цей клієнт загубиться серед десятка інших, і водій
    // поїде його шукати. Приблизні піни геокодера не перебиваємо: їх
    // більшість, і модалка на кожному додаванні перестала б читатися.
    if (ok && pinUnusable(c)) {
      setPinTarget({
        counterpartyId: c.id,
        name: c.name,
        address: c.address,
        lat: c.lat,
        lng: c.lng,
        approximate: c.geoSource !== "MANUAL",
      });
    }
  };

  const addErrand = async () => {
    if (!exTitle.trim()) {
      setError("Напишіть, що зробити — водій прочитає це в чек-листі");
      return;
    }
    const ok = await call(
      `/api/erp/delivery-routes/${routeId}/add-stop`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: exKind,
          title: exTitle.trim(),
          address: exAddress.trim() || null,
          payOverride: exPay ? parseFloat(exPay) : null,
        }),
      },
      "add:errand"
    );
    if (ok) {
      setExTitle("");
      setExAddress("");
      setExPay("");
      setAdding(null);
    }
  };

  return (
    <div>
      {previewing && (
        <div
          style={{
            margin: "8px 20px",
            padding: "8px 12px",
            borderRadius: "8px",
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            color: "#1D4ED8",
            fontSize: "12.5px",
          }}
        >
          Показано <b>запропонований</b> порядок — той самий, що на карті вище.
          Поки не натиснуто «Обрати цей», у маршруті збережено старий порядок,
          тому стрілки ↑↓ тимчасово вимкнені.
        </div>
      )}
      {error && (
        <div
          style={{
            margin: "8px 20px",
            padding: "10px 12px",
            borderRadius: "8px",
            background: "#FEF2F2",
            color: "#B91C1C",
            fontSize: "13px",
          }}
        >
          {error}
        </div>
      )}

      {stops.length === 0 && (
        <p style={{ padding: "16px 20px", fontSize: "13px", color: "#9CA3AF" }}>
          Точок немає. Додайте замовлення або поїздку — без жодної точки маршрут
          не передається водієві.
        </p>
      )}

      {shown.map((stop, idx) => {
        const isErrand = stop.kind !== "DELIVERY";
        const rowBusy = busy?.endsWith(stop.id);
        const cp = stop.counterparty;
        // Точка без координат або з піном від геокодера: водій поїде «в
        // район», а не за адресою. Саме це менеджер і має виправити.
        const noPin = !!cp && cp.deliveryLat == null;
        const roughPin = !!cp && cp.deliveryLat != null && cp.geoSource !== "MANUAL";
        return (
          <div
            key={stop.id}
            className="flex items-start gap-3"
            style={{
              padding: "10px 20px",
              borderBottom: "1px solid #F9FAFB",
              opacity: rowBusy ? 0.5 : 1,
              background: isErrand ? "#FFFDF5" : undefined,
            }}
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
              style={{
                background: stop.status === "DELIVERED" ? "#F0FDF4" : "#EFF6FF",
                fontSize: "12px",
                fontWeight: 700,
                color: stop.status === "DELIVERED" ? "#16A34A" : "#2563EB",
                marginTop: "2px",
              }}
            >
              {idx + 1}
            </div>

            <div className="flex-1 min-w-0">
              <p style={{ fontSize: "14px", fontWeight: 500 }}>
                {isErrand && (
                  <span style={{ marginRight: "6px" }}>{KIND_ICON[stop.kind]}</span>
                )}
                {stop.title || stop.counterparty?.name || "—"}
                {isErrand && (
                  <span
                    style={{
                      marginLeft: "8px",
                      fontSize: "11px",
                      fontWeight: 600,
                      padding: "2px 6px",
                      borderRadius: "4px",
                      background: "#FEF3C7",
                      color: "#92400E",
                    }}
                  >
                    {KIND_LABEL[stop.kind]}
                  </span>
                )}
              </p>
              {stop.address && (
                <p style={{ fontSize: "12px", color: "#9CA3AF" }}>{stop.address}</p>
              )}
              {stop.notes && (
                <p style={{ fontSize: "12px", color: "#6B7280", fontStyle: "italic" }}>
                  {stop.notes}
                </p>
              )}

              {editable && (
                <div className="flex flex-wrap items-center gap-2" style={{ marginTop: "6px" }}>
                  {/* Уточнення піна — перше, що має впасти в око: без нього
                      водій поїде за приблизною координатою. */}
                  {cp && (noPin || roughPin) && (
                    <button
                      onClick={() => setPinTarget(stopPin(stop))}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "1px solid #FCD34D",
                        background: "#FFFBEB",
                        color: "#92400E",
                      }}
                    >
                      {noPin ? "📍 Немає точки на карті" : "📍 Точка приблизна"}
                    </button>
                  )}
                  {cp && !noPin && !roughPin && (
                    <button
                      onClick={() => setPinTarget(stopPin(stop))}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "1px solid #E5E7EB",
                        background: "white",
                        color: "#6B7280",
                      }}
                    >
                      📍 Точка уточнена
                    </button>
                  )}
                  {/* Зона впливає лише на тариф за точку; для поїздки з
                      власною ціною вона нічого не вирішує, тому не показуємо. */}
                  {!isErrand && stop.payOverride == null && (
                    <>
                      <ZoneButton
                        active={stop.zoneOverride === "CITY"}
                        onClick={() =>
                          setZone(stop, stop.zoneOverride === "CITY" ? null : "CITY")
                        }
                      >
                        Місто
                      </ZoneButton>
                      <ZoneButton
                        active={stop.zoneOverride === "OBLAST"}
                        onClick={() =>
                          setZone(stop, stop.zoneOverride === "OBLAST" ? null : "OBLAST")
                        }
                      >
                        Область
                      </ZoneButton>
                      {stop.zoneOverride && (
                        <span style={{ fontSize: "11px", color: "#9CA3AF" }}>
                          вручну
                        </span>
                      )}
                    </>
                  )}
                  {stop.payOverride != null && (
                    <span
                      style={{
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "#92400E",
                        background: "#FEF3C7",
                        padding: "2px 8px",
                        borderRadius: "4px",
                      }}
                    >
                      оплата {formatPrice(stop.payOverride)}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="text-right flex-shrink-0">
              {stop.salesDocument && (
                <>
                  <p style={{ fontSize: "13px", fontWeight: 600 }}>
                    {stop.salesDocument.number}
                  </p>
                  <p style={{ fontSize: "13px", color: "#6B7280" }}>
                    {formatPrice(stop.salesDocument.totalAmount || 0)}
                  </p>
                </>
              )}
              {editable && (
                <div className="flex items-center gap-1" style={{ marginTop: "4px" }}>
                  <IconBtn
                    disabled={idx === 0 || !!busy || previewing}
                    onClick={() => move(idx, -1)}
                    title={previewing ? "Спершу збережіть запропонований порядок" : "Вище"}
                  >
                    ↑
                  </IconBtn>
                  <IconBtn
                    disabled={idx === shown.length - 1 || !!busy || previewing}
                    onClick={() => move(idx, 1)}
                    title={previewing ? "Спершу збережіть запропонований порядок" : "Нижче"}
                  >
                    ↓
                  </IconBtn>
                  <IconBtn
                    disabled={!!busy}
                    onClick={() => removeStop(stop)}
                    title="Прибрати з маршруту"
                    danger
                  >
                    ✕
                  </IconBtn>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {editable && (
        <div style={{ padding: "12px 20px", background: "#FAFAFA" }}>
          {adding === null && (
            <div className="flex gap-2">
              <SmallBtn onClick={() => setAdding("order")}>+ Замовлення</SmallBtn>
              <SmallBtn onClick={() => setAdding("client")}>+ Клієнт з бази</SmallBtn>
              <SmallBtn onClick={() => setAdding("errand")}>+ Поїздка</SmallBtn>
            </div>
          )}

          {adding === "order" && (
            <div>
              <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Додати замовлення ({availableOrders.length})
                </span>
                <SmallBtn onClick={() => setAdding(null)}>Закрити</SmallBtn>
              </div>
              {availableOrders.length === 0 ? (
                <p style={{ fontSize: "13px", color: "#9CA3AF" }}>
                  Вільних підтверджених замовлень немає
                </p>
              ) : (
                <div
                  className="max-h-48 overflow-auto"
                  style={{ border: "1px solid #E5E7EB", borderRadius: "8px", background: "white" }}
                >
                  {availableOrders.map((o) => (
                    <button
                      key={o.id}
                      onClick={() => addOrder(o.id)}
                      disabled={!!busy}
                      className="flex items-center justify-between w-full hover:bg-gray-50"
                      style={{
                        padding: "8px 12px",
                        border: "none",
                        background: "none",
                        borderBottom: "1px solid #F3F4F6",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ fontSize: "13px" }}>
                        <b>{o.number}</b>
                        <span style={{ color: "#6B7280", marginLeft: "8px" }}>
                          {o.counterparty?.name || "—"}
                        </span>
                      </span>
                      <span style={{ fontSize: "13px", fontWeight: 600 }}>
                        {formatPrice(o.totalAmount)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {adding === "client" && (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "12px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "8px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>
                  Знайти клієнта в базі
                </span>
                <SmallBtn onClick={() => setAdding(null)}>Закрити</SmallBtn>
              </div>
              <ClientSearch
                autoFocus
                onPick={addClient}
                busyId={busy?.startsWith("add:") ? busy.slice(4) : null}
                pickedIds={stops
                  .map((s) => s.counterparty?.id)
                  .filter((id): id is string => !!id)}
                onFixPin={(c) =>
                  setPinTarget({
                    counterpartyId: c.id,
                    name: c.name,
                    address: c.address,
                    lat: c.lat,
                    lng: c.lng,
                    approximate: c.geoSource !== "MANUAL",
                  })
                }
              />
              <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "8px" }}>
                Точка без накладної: у чек-листі водія буде назва клієнта, а
                тариф за точку рахується як за звичайну доставку.
              </p>
            </div>
          )}

          {adding === "errand" && (
            <div style={{ background: "white", border: "1px solid #E5E7EB", borderRadius: "8px", padding: "12px" }}>
              <div className="flex items-center justify-between" style={{ marginBottom: "10px" }}>
                <span style={{ fontSize: "13px", fontWeight: 600 }}>Додаткова поїздка</span>
                <SmallBtn onClick={() => setAdding(null)}>Закрити</SmallBtn>
              </div>

              <div className="flex gap-2" style={{ marginBottom: "8px" }}>
                <ZoneButton active={exKind === "PICKUP"} onClick={() => setExKind("PICKUP")}>
                  Забрати товар
                </ZoneButton>
                <ZoneButton active={exKind === "ERRAND"} onClick={() => setExKind("ERRAND")}>
                  Доручення
                </ZoneButton>
              </div>

              <input
                value={exTitle}
                onChange={(e) => setExTitle(e.target.value)}
                placeholder={
                  exKind === "PICKUP" ? "Забрати ремонт у клієнта" : "Відвезти ремонт на Нову пошту"
                }
                style={inputStyle}
              />
              <input
                value={exAddress}
                onChange={(e) => setExAddress(e.target.value)}
                placeholder="Адреса (необов'язково)"
                style={{ ...inputStyle, marginTop: "8px" }}
              />
              <input
                type="number"
                step="1"
                value={exPay}
                onChange={(e) => setExPay(e.target.value)}
                placeholder="Оплата водію, ₴"
                style={{ ...inputStyle, marginTop: "8px" }}
              />
              <p style={{ fontSize: "11px", color: "#9CA3AF", marginTop: "6px" }}>
                Без указаної суми поїздка не потрапить у зарплату — тариф за
                точку до неї не застосовується.
              </p>

              <button
                onClick={addErrand}
                disabled={!!busy}
                style={{
                  marginTop: "10px",
                  background: "#FFD600",
                  color: "#0A0A0A",
                  padding: "10px 18px",
                  borderRadius: "8px",
                  fontWeight: 700,
                  fontSize: "14px",
                  border: "none",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {busy === "add:errand" ? "Додаю..." : "Додати в маршрут"}
              </button>
            </div>
          )}
        </div>
      )}

      {pinTarget && (
        <StopPinModal
          counterpartyId={pinTarget.counterpartyId}
          name={pinTarget.name}
          address={pinTarget.address}
          lat={pinTarget.lat}
          lng={pinTarget.lng}
          approximate={pinTarget.approximate}
          onClose={() => setPinTarget(null)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}

/** Кого і з якою координатою відкриваємо в карті. */
type PinTarget = {
  counterpartyId: string;
  name: string;
  address: string | null;
  lat: number | null;
  lng: number | null;
  approximate: boolean;
};

/**
 * Точка списку → ціль для карти.
 *
 * Координата береться з картки клієнта, а не з точки: виправлення має діяти
 * на всі майбутні маршрути, а не лише на цей.
 */
function stopPin(stop: Stop): PinTarget {
  const cp = stop.counterparty!;
  return {
    counterpartyId: cp.id,
    name: cp.name,
    address: stop.address,
    lat: cp.deliveryLat ?? null,
    lng: cp.deliveryLng ?? null,
    approximate: cp.geoSource !== "MANUAL",
  };
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "9px 12px",
  borderRadius: "8px",
  border: "1px solid #E5E7EB",
  fontSize: "14px",
};

function ZoneButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: "6px",
        fontSize: "12px",
        fontWeight: 600,
        border: active ? "1px solid #0A0A0A" : "1px solid #E5E7EB",
        background: active ? "#0A0A0A" : "white",
        color: active ? "white" : "#6B7280",
      }}
    >
      {children}
    </button>
  );
}

function SmallBtn({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 12px",
        borderRadius: "6px",
        fontSize: "13px",
        fontWeight: 600,
        border: "1px solid #E5E7EB",
        background: "white",
        color: "#0A0A0A",
      }}
    >
      {children}
    </button>
  );
}

function IconBtn({
  onClick,
  disabled,
  title,
  danger,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        width: "26px",
        height: "26px",
        borderRadius: "6px",
        border: "1px solid #E5E7EB",
        background: "white",
        color: danger ? "#DC2626" : "#6B7280",
        fontSize: "13px",
        lineHeight: 1,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {children}
    </button>
  );
}
