"use client";

/**
 * Уточнення точки клієнта на карті — для торгового, з телефона.
 *
 * Геокодер здебільшого знаходить лише місто: «площа Ринок, Львів» стоїть
 * у трьох десятків магазинів одночасно. Де насправді точка, знає той, хто
 * до неї їздить, тому виправляє її торговий, а не керівник.
 *
 * Головний сценарій — стоячи біля магазину натиснути «Я зараз тут»: це
 * точніше за будь-яке тягання пальцем по мапі. Тягання лишається запасним
 * шляхом для тих, хто уточнює ввечері за столом.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { Body, Button, Card, Note, Page } from "@/components/cabinet/ui";
import { Check, LocateFixed } from "lucide-react";

const PinPicker = dynamic(() => import("@/components/map/PinPicker"), {
  ssr: false,
  loading: () => (
    <div
      className="w-full animate-pulse"
      style={{ height: "clamp(320px, 58vh, 520px)", borderRadius: "16px", background: "#EEE" }}
    />
  ),
});

/** Львів — якщо в клієнта немає взагалі нічого, починаємо звідси. */
const FALLBACK = { lat: 49.8397, lng: 24.0297 };

type Summary = {
  counterparty: {
    id: string;
    name: string;
    address: string | null;
    deliveryLat: number | null;
    deliveryLng: number | null;
    geoSource: string | null;
  };
};

export default function ClientPinPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [data, setData] = useState<Summary["counterparty"] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [moved, setMoved] = useState(false);
  const [busy, setBusy] = useState<"gps" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** Точність GPS у метрах — торговому корисно знати, чи можна вірити. */
  const [accuracy, setAccuracy] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/erp/counterparties/${id}/summary`)
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
        return json as Summary;
      })
      .then((json) => {
        if (!alive) return;
        const cp = json.counterparty;
        setData(cp);
        setPos(
          cp.deliveryLat != null && cp.deliveryLng != null
            ? { lat: cp.deliveryLat, lng: cp.deliveryLng }
            : FALLBACK
        );
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "Не вдалося завантажити"));
    return () => {
      alive = false;
    };
  }, [id]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setError("Телефон не дає доступу до GPS");
      return;
    }
    setBusy("gps");
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude });
        setAccuracy(p.coords.accuracy);
        setMoved(true);
        setSaved(false);
        setBusy(null);
      },
      (e) => {
        setBusy(null);
        setError(
          e.code === e.PERMISSION_DENIED
            ? "Доступ до місця заборонено. Увімкніть його в налаштуваннях браузера."
            : "Не вдалося визначити місце. Спробуйте ще раз надворі."
        );
      },
      // enableHighAccuracy — саме те, заради чого все це: без нього
      // телефон віддає точку за вишками, а це ті самі сотні метрів,
      // від яких ми тікаємо.
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  const onPick = useCallback((lat: number, lng: number) => {
    setPos({ lat, lng });
    setAccuracy(null);
    setMoved(true);
    setSaved(false);
  }, []);

  const save = async () => {
    if (!pos) return;
    setBusy("save");
    setError(null);
    try {
      const res = await fetch(`/api/admin/client-map/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // accuracyM їде разом із точкою: за ним у звіті видно, чи торговий
        // стояв біля дверей («Я зараз тут»), чи посунув пін пальцем.
        body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracyM: accuracy }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setSaved(true);
      setMoved(false);
      // Трохи затримки, щоб торговий побачив підтвердження, а не миготіння.
      setTimeout(() => router.push(`/sales/clients/${id}`), 900);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося зберегти точку");
    } finally {
      setBusy(null);
    }
  };

  if (loadError) {
    return (
      <div>
        <SalesHeader title="Точка на карті" backTo={`/sales/clients/${id}`} />
        <p style={{ fontSize: "14px", color: "#DC2626" }}>{loadError}</p>
      </div>
    );
  }

  if (!data || !pos) {
    return (
      <div>
        <SalesHeader title="Точка на карті" backTo={`/sales/clients/${id}`} />
        <div
          className="w-full animate-pulse"
          style={{ height: "clamp(320px, 58vh, 520px)", borderRadius: "16px", background: "#EEE" }}
        />
      </div>
    );
  }

  const exact = data.geoSource === "MANUAL";

  return (
    <>
      <SalesHeader title={data.name} subtitle="Точка на карті" backTo={`/sales/clients/${id}`} />

      <Page>
        <Card tone={exact ? "plain" : "warn"} className="flex flex-col gap-1">
          <Body>
            {exact
              ? "Точку вже уточнено вручну. Якщо магазин переїхав — поставте нову."
              : "Точку поставив геокодер за адресою, тому вона часто показує центр міста чи ринок. Станьте біля магазину й натисніть «Я зараз тут»."}
          </Body>
          {!!data.address && <Note>{data.address}</Note>}
        </Card>

        <PinPicker lat={pos.lat} lng={pos.lng} onChange={onPick} />

        {accuracy != null && (
          <Note tone={accuracy > 40 ? "warn" : undefined}>
            GPS дав точність ±{Math.round(accuracy)} м
            {accuracy > 40 ? " — якщо це неточно, посуньте пін пальцем" : ""}
          </Note>
        )}

        {!!error && (
          <Card tone="bad">
            <p className="text-[13px] text-bad-fg">{error}</p>
          </Card>
        )}

        {saved && (
          <Card tone="ok">
            <p className="text-[13px] text-ok-fg">Точку збережено. Дякуємо!</p>
          </Card>
        )}

        {/* Кнопки внизу: великою мішенню під палець, у зоні великого пальця.
            «Зберегти» лишається неактивною, поки пін не зрушив, — інакше
            людина зберігає ту саму здогадку геокодера й вважає, що уточнила. */}
        <Button tone="outline" onClick={useMyLocation} disabled={busy !== null} className="w-full">
          <LocateFixed size={18} className="text-info" />
          {busy === "gps" ? "Визначаю…" : "Я зараз тут"}
        </Button>

        <Button
          tone={moved ? "ok" : "outline"}
          onClick={save}
          disabled={busy !== null || !moved}
          className="w-full"
        >
          {moved && <Check size={18} />}
          {busy === "save" ? "Зберігаю…" : "Зберегти точку"}
        </Button>

        <Note>Точка лишиться всім — і торговому, і офісу, і водієві на маршруті.</Note>
      </Page>
    </>
  );
}
