import L from "leaflet";

/**
 * Мітка місця, де стояв торговий (A, B, C…) — lib/routes/pin-candidates.
 * Спільна для адмін-карти клієнтів і черги «Точки з треку». Фіолетове
 * коло з літерою — не плутається ні з клієнтом, ні з ромбом бази.
 */
export function candidatePin(label: string, active = false): L.DivIcon {
  const size = active ? 32 : 26;
  return L.divIcon({
    className: "",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:50%;
      background:#7C3AED;color:#fff;border:${active ? 3 : 2}px solid #fff;
      box-shadow:0 1px 6px rgba(0,0,0,0.4);
      display:flex;align-items:center;justify-content:center;
      font:700 13px system-ui;
    ">${label}</div>`,
  });
}
