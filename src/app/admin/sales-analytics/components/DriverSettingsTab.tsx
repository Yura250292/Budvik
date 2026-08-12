"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useApi } from "./useApi";
import { ErrorBox } from "./ErrorBox";

/**
 * Налаштування водіїв: прив'язка до 1С і ставки.
 *
 * Прив'язку не робимо автоматично за іменем: водіїв одиниці, а помилка
 * коштує чужої зарплати. Після прив'язки старі листи цього водія
 * підхоплюються ретроспективно — API повертає, скільки саме.
 */

type MappingResponse = {
  unmapped: Array<{
    driverExternalId1C: string;
    driverName1C: string | null;
    sheetsCount: number;
    lastSheetAt: string | null;
  }>;
  drivers: Array<{
    id: string;
    name: string;
    email: string;
    driver1CExternalId: string | null;
  }>;
};

type RatesResponse = {
  canEdit: boolean;
  rates: {
    kmTier1Max: number;
    kmTier1Rate: number;
    kmTier2Max: number;
    kmTier2Rate: number;
    kmTier3Rate: number;
    cityPointRate: number;
    oblastPointRate: number;
    turnoverPercent: number;
  };
};

type RatesForm = Record<keyof RatesResponse["rates"], string>;

const RATE_FIELDS: Array<{ key: keyof RatesResponse["rates"]; label: string; hint?: string }> = [
  { key: "kmTier1Max", label: "Межа першого тіру, км", hint: "менше цього — перша ставка" },
  { key: "kmTier1Rate", label: "Ставка до межі, ₴" },
  { key: "kmTier2Max", label: "Межа другого тіру, км", hint: "включно" },
  { key: "kmTier2Rate", label: "Ставка середнього тіру, ₴" },
  { key: "kmTier3Rate", label: "Ставка понад другу межу, ₴" },
  { key: "cityPointRate", label: "Точка в місті, ₴" },
  { key: "oblastPointRate", label: "Точка в області, ₴" },
  { key: "turnoverPercent", label: "Відсоток від суми в листі, %" },
];

export function DriverSettingsTab() {
  const mapping = useApi<MappingResponse>("/api/admin/drivers/mapping");
  const rates = useApi<RatesResponse>("/api/admin/drivers/rates");

  const [selection, setSelection] = useState<Record<string, string>>({});
  const [form, setForm] = useState<RatesForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Форма ставок наповнюється, коли прийшли дані, і не перетирає введене
  // адміном при перезавантаженні списку прив'язок.
  useEffect(() => {
    if (rates.data && !form) {
      const r = rates.data.rates;
      setForm({
        kmTier1Max: String(r.kmTier1Max),
        kmTier1Rate: String(r.kmTier1Rate),
        kmTier2Max: String(r.kmTier2Max),
        kmTier2Rate: String(r.kmTier2Rate),
        kmTier3Rate: String(r.kmTier3Rate),
        cityPointRate: String(r.cityPointRate),
        oblastPointRate: String(r.oblastPointRate),
        turnoverPercent: String(r.turnoverPercent),
      });
    }
  }, [rates.data, form]);

  async function linkDriver(externalId: string) {
    const userId = selection[externalId];
    if (!userId) return;
    setBusy(true);
    setMessage(null);
    setNote(null);
    try {
      const res = await fetch("/api/admin/drivers/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driverExternalId1C: externalId, userId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося прив'язати");
      setNote(`Прив'язано. Оновлено маршрутних листів: ${json.linkedSheets}.`);
      mapping.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка прив'язки");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkDriver(userId: string) {
    setBusy(true);
    setMessage(null);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/drivers/mapping?userId=${userId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося відв'язати");
      setNote(`Відв'язано. Листів повернуто в нерозподілені: ${json.unlinkedSheets}.`);
      mapping.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка");
    } finally {
      setBusy(false);
    }
  }

  async function saveRates() {
    if (!form) return;
    setBusy(true);
    setMessage(null);
    setNote(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([k, v]) => [k, Number(v)])
      );
      const res = await fetch("/api/admin/drivers/rates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setNote("Ставки збережено. Зарплата за всі періоди перерахована за новими значеннями.");
      rates.reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Помилка збереження");
    } finally {
      setBusy(false);
    }
  }

  if (mapping.error) return <ErrorBox message={mapping.error} onRetry={mapping.reload} />;
  if (mapping.loading && !mapping.data) return <TableSkeleton rows={4} cols={3} />;

  const canEdit = rates.data?.canEdit ?? false;
  const mapped = mapping.data?.drivers.filter((d) => d.driver1CExternalId) ?? [];

  return (
    <div className="space-y-4">
      {message && <ErrorBox message={message} />}
      {note && (
        <div className="rounded-[var(--radius-card)] border border-green-200 bg-green-50 p-3">
          <p className="text-sm text-green-800">{note}</p>
        </div>
      )}

      <Card padded={false}>
        <div className="p-4 sm:p-5">
          <CardHeader
            title="Водії з 1С без акаунта"
            hint="Маршрутні листи цих водіїв прийшли, але зарплата за ними не нараховується, доки їх не прив'язано."
          />
        </div>

        {(mapping.data?.unmapped.length ?? 0) === 0 ? (
          <div className="px-4 pb-5 sm:px-5">
            <EmptyState title="Усі водії прив'язані" hint="Нових водіїв з 1С не з'явилося." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Водій у 1С</th>
                  <th className="px-4 py-2.5 text-right">Листів</th>
                  <th className="px-4 py-2.5">Акаунт на сайті</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {mapping.data!.unmapped.map((u) => (
                  <tr key={u.driverExternalId1C} className="hover:bg-g50">
                    <td className="px-4 py-3">
                      <span className="font-medium text-bk">{u.driverName1C ?? "без імені"}</span>
                      <span className="ml-2 text-xs text-g400">{u.driverExternalId1C.slice(0, 12)}…</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-g600">{u.sheetsCount}</td>
                    <td className="px-4 py-3">
                      <select
                        value={selection[u.driverExternalId1C] ?? ""}
                        disabled={!canEdit || busy}
                        aria-label={`Акаунт для ${u.driverName1C ?? "водія"}`}
                        onChange={(e) =>
                          setSelection((s) => ({ ...s, [u.driverExternalId1C]: e.target.value }))
                        }
                        className="w-56 cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2 py-1 text-xs text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark"
                      >
                        <option value="">— оберіть акаунт —</option>
                        {mapping.data!.drivers
                          .filter((d) => !d.driver1CExternalId)
                          .map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.email})
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => linkDriver(u.driverExternalId1C)}
                        disabled={!canEdit || busy || !selection[u.driverExternalId1C]}
                        className="cursor-pointer rounded-[var(--radius-badge)] bg-primary px-2.5 py-1 text-xs font-semibold text-bk transition-colors hover:bg-primary-hover disabled:opacity-50"
                      >
                        Прив&apos;язати
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {mapped.length > 0 && (
        <Card padded={false}>
          <div className="p-4 sm:p-5">
            <CardHeader title="Прив'язані водії" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-y border-g200 bg-g50 text-left text-xs font-medium text-g500">
                  <th className="px-4 py-2.5">Акаунт</th>
                  <th className="px-4 py-2.5">Ref_Key у 1С</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {mapped.map((d) => (
                  <tr key={d.id} className="hover:bg-g50">
                    <td className="px-4 py-3 font-medium text-bk">
                      {d.name}
                      <span className="ml-2 text-xs font-normal text-g400">{d.email}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-g500">{d.driver1CExternalId}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => unlinkDriver(d.id)}
                        disabled={!canEdit || busy}
                        className="cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk disabled:opacity-50"
                      >
                        Відв&apos;язати
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Ставки"
          hint="Історії ставок немає: зміна перерахує зарплату і за минулі періоди."
        />
        {!form ? (
          <TableSkeleton rows={3} cols={2} />
        ) : (
          <>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {RATE_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-xs font-medium text-g600">{f.label}</span>
                  <input
                    type="number"
                    step={f.key === "turnoverPercent" ? 0.1 : 5}
                    min={0}
                    value={form[f.key]}
                    disabled={!canEdit}
                    onChange={(e) => setForm((prev) => (prev ? { ...prev, [f.key]: e.target.value } : prev))}
                    className="mt-1 w-full rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-sm tabular-nums text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark disabled:bg-g50"
                  />
                  {f.hint && <span className="mt-0.5 block text-[11px] text-g400">{f.hint}</span>}
                </label>
              ))}
            </div>

            {canEdit && (
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={saveRates}
                  disabled={busy}
                  className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:opacity-60"
                >
                  Зберегти ставки
                </button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
