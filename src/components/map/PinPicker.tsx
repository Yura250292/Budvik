"use client";

/**
 * Вибір однієї точки на карті: перетягни маркер або тапни, де стоїть магазин.
 *
 * Окремо від ClientMap, бо той малює сотні точок на canvas-рендерері й
 * тягне за собою легенду, попапи та розсіювання збігів. Тут навпаки —
 * один маркер, палець замість миші й максимально просте керування:
 * торговий відкриває це в машині біля магазину.
 */

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/** Маркер-крапля: помітний на супутниковій підкладці й на світлій мапі. */
function pinIcon(): L.DivIcon {
  return L.divIcon({
    className: "",
    iconSize: [30, 30],
    iconAnchor: [15, 29],
    html: `<div style="
      width:30px;height:30px;
      display:flex;align-items:center;justify-content:center;
    ">
      <div style="
        width:22px;height:22px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        background:#2a78d6;border:3px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.4);
      "></div>
    </div>`,
  });
}

export default function PinPicker({
  lat,
  lng,
  onChange,
  height = "clamp(320px, 58vh, 520px)",
}: {
  lat: number;
  lng: number;
  /** Викликається на перетягування маркера й на тап по карті. */
  onChange: (lat: number, lng: number) => void;
  height?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      zoomControl: true,
      attributionControl: true,
      // На телефоні зум колесом не потрібен, а от подвійний тап заважає:
      // ним легко промахнутися замість того, щоб поставити точку.
      doubleClickZoom: false,
    }).setView([lat, lng], 17); // 17 — видно окремі будинки

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker([lat, lng], { icon: pinIcon(), draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const p = marker.getLatLng();
      changeRef.current(p.lat, p.lng);
    });

    // Тап по карті теж переставляє пін: на телефоні це швидше, ніж тягти.
    map.on("click", (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      changeRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;
    markerRef.current = marker;
    // Ініціалізація один раз; координати ззовні синхронізує ефект нижче.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Координати змінили ззовні (кнопка «я зараз тут» або пошук адреси).
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    const cur = marker.getLatLng();
    // Поріг ~1 м: інакше власний dragend смикав би карту назад.
    if (Math.abs(cur.lat - lat) < 1e-5 && Math.abs(cur.lng - lng) < 1e-5) return;

    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 17));
  }, [lat, lng]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  return (
    // contain: layout paint тут був і його прибрано: він з'їдав прокрутку —
    // до підказки про точність GPS і кнопки під картою не догорталося.
    <div
      className="relative isolate overflow-hidden"
      style={{ height, width: "100%", borderRadius: "16px" }}
    >
      <div ref={containerRef} style={{ height: "100%", width: "100%" }} />
    </div>
  );
}
