/**
 * Картка машини: ТО, журнал обслуговування, закріплення, амортизація.
 */

import { useRef, useState } from "react";
import { Card, CardHeader, EmptyState } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { ErrorBox } from "@/components/ui/ErrorBox";
import { CardSkeleton } from "@/components/ui/Skeleton";
import { TableScroll } from "@/components/ui/TableScroll";
import { money, num } from "@/components/ui/Stat";
import { useApi } from "@/components/ui/useApi";
import { DUE_LABEL } from "@/lib/fleet/due";
import { KIND_LABEL, KINDS } from "@/lib/fleet/kinds";
import { VehicleForm } from "./VehicleForm";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  DUE_STATUS,
  Field,
  INPUT,
  ddmmyyyy,
  dueText,
  send,
  shrinkReceipt,
  todayKyiv,
  type DetailResponse,
  type FleetVehicle,
  type Person,
  type ServiceRow,
} from "./ui";

const SOURCE_LABEL = { manual: "внесено руками", service: "із журналу", shift: "зі зміни" } as const;

export function VehicleDetail({
  id,
  people,
  onChanged,
  onClose,
}: {
  id: string;
  people: Person[];
  onChanged: () => void;
  onClose: () => void;
}) {
  const { data, loading, error, reload } = useApi<DetailResponse>(`/api/admin/fleet/vehicles/${id}`);
  const [editing, setEditing] = useState(false);

  const changed = () => {
    reload();
    onChanged();
  };

  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading && !data) return <CardSkeleton rows={6} />;
  if (!data) return null;
  const v = data.vehicle;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={`${v.plate} · ${v.make} ${v.model}${v.year ? `, ${v.year}` : ""}`}
          hint={[
            v.holder ? `Їздить ${v.holder.name} з ${ddmmyyyy(v.holder.since)}` : "Ні за ким не закріплена",
            v.odometer
              ? `пробіг ${num(v.odometer.km)} км (${SOURCE_LABEL[v.odometer.source]}${v.odometer.by ? ` ${v.odometer.by}` : ""}, ${ddmmyyyy(v.odometer.day)})`
              : "пробіг невідомий",
            !v.active ? "знята з обліку" : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          action={
            <div className="flex shrink-0 gap-2">
              {!editing && (
                <button type="button" className={BTN_GHOST} onClick={() => setEditing(true)}>
                  Редагувати
                </button>
              )}
              <button type="button" className={BTN_GHOST} onClick={onClose}>
                Закрити
              </button>
            </div>
          }
        />
        {editing ? (
          <VehicleForm
            vehicle={v}
            onSaved={() => {
              setEditing(false);
              changed();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <DueBlock vehicle={v} onChanged={changed} />
            <DepreciationBlock vehicle={v} />
          </div>
        )}
      </Card>

      <ServicesCard vehicleId={id} services={data.services} onChanged={changed} />

      <AssignCard vehicle={v} people={people} assignments={data.assignments} onChanged={changed} />

      {!editing && (
        <div className="flex justify-end">
          <button
            type="button"
            className={BTN_GHOST}
            onClick={async () => {
              if (v.active && !confirm(`Зняти ${v.plate} з обліку? Історія лишиться, машина зникне зі списку й нагадувань.`)) return;
              await send(`/api/admin/fleet/vehicles/${id}`, "PATCH", { active: !v.active });
              changed();
            }}
          >
            {v.active ? "Зняти з обліку (продана, списана)" : "Повернути в облік"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── ТО: стан за правилами і редактор правил ─────────────────────────── */

type RuleForm = { kind: string; title: string; everyKm: string; everyMonths: string };

const RULE_PRESETS: RuleForm[] = [
  { kind: "OIL", title: "Масло й фільтр оливи", everyKm: "10000", everyMonths: "12" },
  { kind: "FILTERS", title: "Повітряний і салонний фільтр", everyKm: "20000", everyMonths: "12" },
  { kind: "TIMING", title: "Ремінь ГРМ", everyKm: "60000", everyMonths: "48" },
  { kind: "BRAKES", title: "Гальмівна рідина", everyKm: "", everyMonths: "24" },
];

function DueBlock({ vehicle, onChanged }: { vehicle: FleetVehicle; onChanged: () => void }) {
  const [edit, setEdit] = useState(false);
  const [rules, setRules] = useState<RuleForm[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setRules(
      vehicle.due.length
        ? vehicle.due.map((d) => ({
            kind: d.kind,
            title: d.title,
            everyKm: d.everyKm == null ? "" : String(d.everyKm),
            everyMonths: d.everyMonths == null ? "" : String(d.everyMonths),
          }))
        : RULE_PRESETS
    );
    setErr(null);
    setEdit(true);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/fleet/vehicles/${vehicle.id}/rules`, "PUT", { rules });
      setEdit(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }

  const upd = (i: number, k: keyof RuleForm, value: string) =>
    setRules((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: value } : r)));

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-bk">Регламент ТО</h3>
        {!edit && (
          <button type="button" className={BTN_GHOST} onClick={startEdit}>
            {vehicle.due.length ? "Змінити правила" : "Задати правила"}
          </button>
        )}
      </div>

      {edit ? (
        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr] gap-2 rounded-[var(--radius-badge)] border border-g200 p-2 sm:grid-cols-[8rem_1fr_6rem_5rem_auto]">
              <select className={INPUT} value={r.kind} onChange={(e) => upd(i, "kind", e.target.value)} aria-label="Вид робіт">
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
              <input className={INPUT} value={r.title} onChange={(e) => upd(i, "title", e.target.value)} placeholder="Назва" aria-label="Назва" />
              <input className={INPUT} value={r.everyKm} onChange={(e) => upd(i, "everyKm", e.target.value)} placeholder="км" inputMode="numeric" aria-label="Кожні, км" />
              <input className={INPUT} value={r.everyMonths} onChange={(e) => upd(i, "everyMonths", e.target.value)} placeholder="міс." inputMode="numeric" aria-label="Кожні, міс." />
              <button type="button" className={BTN_GHOST} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}>
                Прибрати
              </button>
            </div>
          ))}
          <p className="text-[11px] text-g500">Кожні N км або M місяців — що настане раніше. Відлік від останнього запису того самого виду в журналі.</p>
          {err && <p className="text-sm text-[#B91C1C]">{err}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={BTN_GHOST}
              onClick={() => setRules((rs) => [...rs, { kind: "OTHER", title: "", everyKm: "", everyMonths: "" }])}
            >
              + Правило
            </button>
            <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={save}>
              {busy ? "Зберігаю…" : "Зберегти правила"}
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setEdit(false)}>
              Скасувати
            </button>
          </div>
        </div>
      ) : vehicle.due.length === 0 ? (
        <p className="text-sm text-g500">Правил немає — нагадувань про заміну не буде.</p>
      ) : (
        <ul className="divide-y divide-g100">
          {vehicle.due.map((d) => (
            <li key={d.kind} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-bk">{d.title}</p>
                <p className="text-xs text-g500">
                  {[d.everyKm ? `кожні ${num(d.everyKm)} км` : null, d.everyMonths ? `${d.everyMonths} міс.` : null]
                    .filter(Boolean)
                    .join(" або ")}
                  {d.lastDay &&
                    ` · востаннє ${ddmmyyyy(d.lastDay)}${d.lastOdometerKm != null ? ` на ${num(d.lastOdometerKm)} км` : ""}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <Badge status={DUE_STATUS[d.state]} dot>
                  {DUE_LABEL[d.state]}
                </Badge>
                <p className="mt-0.5 text-xs text-g500">{dueText(d)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DepreciationBlock({ vehicle }: { vehicle: FleetVehicle }) {
  const d = vehicle.depreciation;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-bk">Амортизація і витрати</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-g500">Обслуговування за рік</dt>
        <dd className="text-right tabular-nums text-bk">{money(vehicle.periodCost)} ₴</dd>
        <dt className="text-g500">Обслуговування за весь час</dt>
        <dd className="text-right tabular-nums text-bk">{money(vehicle.totalCost)} ₴</dd>
        {d ? (
          <>
            <dt className="text-g500">Знос на місяць</dt>
            <dd className="text-right tabular-nums text-bk">
              {d.fullyDepreciated ? "повністю самортизована" : `${money(d.monthly)} ₴`}
            </dd>
            <dt className="text-g500">Нараховано ({d.monthsElapsed} міс.)</dt>
            <dd className="text-right tabular-nums text-bk">{money(d.accrued)} ₴</dd>
            <dt className="text-g500">Залишкова вартість</dt>
            <dd className="text-right font-semibold tabular-nums text-bk">{money(d.bookValue)} ₴</dd>
            <dt className="text-g500">Знос на 1 км</dt>
            <dd className="text-right tabular-nums text-bk">{d.perKm == null ? "—" : `${num(d.perKm, 2)} ₴`}</dd>
          </>
        ) : (
          <dd className="col-span-2 text-xs text-g500">
            Амортизація не рахується: вкажіть ціну, дату купівлі й строк служби («Редагувати»).
          </dd>
        )}
      </dl>
    </div>
  );
}

/* ── Журнал обслуговування ────────────────────────────────────────────── */

type ServiceForm = {
  day: string;
  kind: string;
  title: string;
  odometerKm: string;
  partsCost: string;
  laborCost: string;
  vendor: string;
  notes: string;
};

function emptyService(): ServiceForm {
  return { day: todayKyiv(), kind: "OIL", title: "", odometerKm: "", partsCost: "", laborCost: "", vendor: "", notes: "" };
}

function ServicesCard({
  vehicleId,
  services,
  onChanged,
}: {
  vehicleId: string;
  services: ServiceRow[];
  onChanged: () => void;
}) {
  /** null — форма закрита; "new" — новий запис; інакше id запису в правці */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyService);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [filter, setFilter] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: keyof ServiceForm) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function open(row: ServiceRow | null) {
    setErr(null);
    setReceipt(null);
    if (fileRef.current) fileRef.current.value = "";
    if (!row) {
      setForm(emptyService());
      setEditing("new");
      return;
    }
    setForm({
      day: row.day,
      kind: row.kind,
      title: row.title,
      odometerKm: row.odometerKm == null ? "" : String(row.odometerKm),
      partsCost: row.partsCost ? String(row.partsCost) : "",
      laborCost: row.laborCost ? String(row.laborCost) : "",
      vendor: row.vendor ?? "",
      notes: row.notes ?? "",
    });
    setEditing(row.id);
  }

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const base = `/api/admin/fleet/vehicles/${vehicleId}/services`;
      let serviceId = editing!;
      if (editing === "new") {
        const res = await send(base, "POST", form);
        serviceId = String(res.id);
      } else {
        await send(`${base}/${editing}`, "PATCH", form);
      }
      if (receipt) {
        const res = await fetch(`${base}/${serviceId}/receipt`, { method: "POST", body: await shrinkReceipt(receipt) });
        if (!res.ok) {
          const json = await res.json().catch(() => null);
          throw new Error(`Запис збережено, але чек не завантажився: ${json?.error ?? res.status}`);
        }
      }
      setEditing(null);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося зберегти");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: ServiceRow) {
    if (!confirm(`Видалити запис «${row.title}» від ${ddmmyyyy(row.day)}?`)) return;
    try {
      await send(`/api/admin/fleet/vehicles/${vehicleId}/services/${row.id}`, "DELETE");
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Не вдалося видалити");
    }
  }

  const shown = filter ? services.filter((s) => s.kind === filter) : services;
  const total = shown.reduce((sum, s) => sum + s.total, 0);

  return (
    <Card>
      <CardHeader
        title="Журнал обслуговування"
        hint="Масло, фільтри, гальма, шини, ремонт — з пробігом і сумою"
        action={
          editing == null && (
            <button type="button" className={BTN_PRIMARY} onClick={() => open(null)}>
              + Запис
            </button>
          )
        }
      />

      {editing != null && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="mb-5 space-y-3 rounded-[var(--radius-card)] border border-g200 bg-g50 p-3"
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Дата *">
              <input className={INPUT} type="date" value={form.day} onChange={set("day")} max={todayKyiv()} required />
            </Field>
            <Field label="Вид *">
              <select className={INPUT} value={form.kind} onChange={set("kind")}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Пробіг, км" hint="Без нього ТО рахується лише за датою">
              <input className={INPUT} value={form.odometerKm} onChange={set("odometerKm")} inputMode="numeric" />
            </Field>
            <Field label="СТО / магазин">
              <input className={INPUT} value={form.vendor} onChange={set("vendor")} />
            </Field>
            <Field label="Що зроблено *" className="col-span-2">
              <input className={INPUT} value={form.title} onChange={set("title")} placeholder="Масло 5W-40, фільтр оливи" required />
            </Field>
            <Field label="Запчастини, ₴">
              <input className={INPUT} value={form.partsCost} onChange={set("partsCost")} inputMode="decimal" />
            </Field>
            <Field label="Робота, ₴">
              <input className={INPUT} value={form.laborCost} onChange={set("laborCost")} inputMode="decimal" />
            </Field>
            <Field label="Нотатки" className="col-span-2">
              <input className={INPUT} value={form.notes} onChange={set("notes")} />
            </Field>
            <Field label="Фото або PDF чека" className="col-span-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setReceipt(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-g600 file:mr-2 file:cursor-pointer file:rounded-[var(--radius-badge)] file:border file:border-g200 file:bg-white file:px-2 file:py-1 file:text-xs"
              />
            </Field>
          </div>
          {err && <p className="text-sm text-[#B91C1C]">{err}</p>}
          <div className="flex gap-2">
            <button type="submit" className={BTN_PRIMARY} disabled={busy}>
              {busy ? "Зберігаю…" : "Зберегти"}
            </button>
            <button type="button" className={BTN_GHOST} onClick={() => setEditing(null)}>
              Скасувати
            </button>
          </div>
        </form>
      )}

      {services.length === 0 ? (
        <EmptyState title="Записів ще немає" hint="Додайте останню заміну масла з пробігом — від неї порахується наступна." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <select className={INPUT.replace("w-full", "w-auto")} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Вид робіт">
              <option value="">Усі види</option>
              {KINDS.filter((k) => services.some((s) => s.kind === k)).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <span className="text-g500">
              {shown.length} зап. на {money(total)} ₴
            </span>
          </div>
          <TableScroll minWidth={760}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-g200 text-left text-xs text-g500">
                  <th className="px-3 py-2 font-medium">Дата</th>
                  <th className="px-3 py-2 font-medium">Вид</th>
                  <th className="px-3 py-2 font-medium">Що зроблено</th>
                  <th className="px-3 py-2 text-right font-medium">Пробіг</th>
                  <th className="px-3 py-2 text-right font-medium">Сума</th>
                  <th className="px-3 py-2 font-medium">СТО</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {shown.map((s) => (
                  <tr key={s.id} className="hover:bg-g50">
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums text-g600">{ddmmyyyy(s.day)}</td>
                    <td className="px-3 py-2">
                      <Badge status="neutral">{s.kindLabel}</Badge>
                    </td>
                    <td className="px-3 py-2 text-bk">
                      {s.title}
                      {s.notes && <span className="block text-xs text-g500">{s.notes}</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-g600">
                      {s.odometerKm == null ? "—" : `${num(s.odometerKm)} км`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-bk">
                      {money(s.total)} ₴
                      {s.laborCost > 0 && s.partsCost > 0 && (
                        <span className="block text-[11px] text-g400">
                          {money(s.partsCost)} + {money(s.laborCost)} роб.
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-g600">{s.vendor ?? ""}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className="inline-flex gap-1.5">
                        {s.hasReceipt && (
                          <a
                            href={`/api/admin/fleet/vehicles/${vehicleId}/services/${s.id}/receipt`}
                            target="_blank"
                            rel="noreferrer"
                            className={BTN_GHOST}
                          >
                            Чек
                          </a>
                        )}
                        <button type="button" className={BTN_GHOST} onClick={() => open(s)}>
                          Змінити
                        </button>
                        <button type="button" className={BTN_GHOST} onClick={() => remove(s)}>
                          ✕
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </Card>
  );
}

/* ── Хто їздить ────────────────────────────────────────────────────────── */

function AssignCard({
  vehicle,
  people,
  assignments,
  onChanged,
}: {
  vehicle: FleetVehicle;
  people: Person[];
  assignments: DetailResponse["assignments"];
  onChanged: () => void;
}) {
  const [userId, setUserId] = useState(vehicle.holder?.userId ?? "");
  const [day, setDay] = useState(todayKyiv());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function assign() {
    setBusy(true);
    setErr(null);
    try {
      await send(`/api/admin/fleet/vehicles/${vehicle.id}/assign`, "POST", { userId: userId || null, day });
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося зберегти");
    } finally {
      setBusy(false);
    }
  }

  const ROLE = { SALES: "торговий", DRIVER: "водій" } as Record<string, string>;

  return (
    <Card>
      <CardHeader
        title="Хто їздить"
        hint="Пробіг зі змін застосунку лягає на машину за цим закріпленням"
      />
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Людина" className="min-w-[14rem] flex-1">
          <select className={INPUT} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">— ні за ким —</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({ROLE[p.role] ?? p.role})
              </option>
            ))}
          </select>
        </Field>
        <Field label="З дня">
          <input className={INPUT} type="date" value={day} onChange={(e) => setDay(e.target.value)} max={todayKyiv()} />
        </Field>
        <button
          type="button"
          className={BTN_PRIMARY}
          disabled={busy || userId === (vehicle.holder?.userId ?? "")}
          onClick={assign}
        >
          {busy ? "Зберігаю…" : "Пересадити"}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-[#B91C1C]">{err}</p>}
      {assignments.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm">
          {assignments.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 text-g600">
              <span className="text-bk">{a.name}</span>
              <span className="tabular-nums">
                {ddmmyyyy(a.from)} — {a.to ? ddmmyyyy(a.to) : "досі"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
