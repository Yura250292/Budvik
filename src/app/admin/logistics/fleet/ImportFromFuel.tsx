/**
 * Перенесення машин із «Палива»: хто за кермом, на чому їздить (підпис з
 * «Палива», розібраний на марку, модель і номер) і чия машина.
 *
 * Людина бачить розбір і править перед створенням: у «Паливі» підпис —
 * вільний текст. Картка ховається, коли переносити вже нікого.
 */

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";
import { TableScroll } from "@/components/ui/TableScroll";
import { num } from "@/components/ui/Stat";
import { useApi } from "@/components/ui/useApi";
import { BTN_GHOST, BTN_PRIMARY, INPUT, ddmmyyyy, send } from "./ui";

type Candidate = {
  userId: string;
  name: string;
  role: string;
  label: string | null;
  parsed: { make: string; model: string; plate: string | null };
  shifts: number;
  firstDay: string | null;
  odometerKm: number | null;
  odometerDay: string | null;
};

type Row = { pick: boolean; make: string; model: string; plate: string; ownership: "COMPANY" | "PERSONAL" };

const ROLE = { SALES: "торговий", DRIVER: "водій" } as Record<string, string>;
const CELL = INPUT.replace("w-full", "w-full min-w-[6rem]");

export function ImportFromFuel({ onDone }: { onDone: () => void }) {
  const { data, reload } = useApi<{ candidates: Candidate[] }>("/api/admin/fleet/import");
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const candidates = data?.candidates ?? [];

  // Типово: є підпис у «Паливі» — переносимо; водій — на машині фірми,
  // торговий — невідомо, тож теж «фірми», а власні людина позначить сама.
  useEffect(() => {
    setRows((prev) => {
      const next: Record<string, Row> = {};
      for (const c of candidates) {
        next[c.userId] = prev[c.userId] ?? {
          pick: !!c.label,
          make: c.parsed.make,
          model: c.parsed.model,
          plate: c.parsed.plate ?? "",
          ownership: "COMPANY",
        };
      }
      return next;
    });
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (candidates.length === 0) {
    return done ? <p className="text-sm text-[#047857]">{done}</p> : null;
  }

  const upd = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));
  const picked = candidates.filter((c) => rows[c.userId]?.pick);

  async function run() {
    setBusy(true);
    setErr(null);
    try {
      const res = await send("/api/admin/fleet/import", "POST", {
        items: picked.map((c) => ({ userId: c.userId, ...rows[c.userId] })),
      });
      setDone(`Перенесено машин: ${res.created}. Кілометраж з їхніх змін уже рахується.`);
      setOpen(false);
      reload();
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося перенести");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={`Машини з «Палива» ще не в автопарку: ${candidates.length}`}
        hint="Торгові й водії, за якими не закріплена жодна машина. Підпис з «Палива» розібрано на марку, модель і номер — перевірте й позначте, чия машина."
        action={
          <button type="button" className={open ? BTN_GHOST : BTN_PRIMARY} onClick={() => setOpen((o) => !o)}>
            {open ? "Згорнути" : "Перенести"}
          </button>
        }
      />
      {done && <p className="mb-3 text-sm text-[#047857]">{done}</p>}
      {open && (
        <>
          <TableScroll minWidth={940}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-g200 text-left text-xs text-g500">
                  <th className="px-2 py-2" />
                  <th className="px-2 py-2 font-medium">Хто їздить</th>
                  <th className="px-2 py-2 font-medium">У «Паливі»</th>
                  <th className="px-2 py-2 font-medium">Марка *</th>
                  <th className="px-2 py-2 font-medium">Модель</th>
                  <th className="px-2 py-2 font-medium">Номер</th>
                  <th className="px-2 py-2 font-medium">Чия</th>
                  <th className="px-2 py-2 text-right font-medium">Одометр зі змін</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-g100">
                {candidates.map((c) => {
                  const r = rows[c.userId];
                  if (!r) return null;
                  return (
                    <tr key={c.userId} className={r.pick ? "" : "opacity-60"}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={r.pick}
                          onChange={(e) => upd(c.userId, { pick: e.target.checked })}
                          aria-label={`Переносити машину ${c.name}`}
                          className="h-4 w-4 cursor-pointer"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <span className="text-bk">{c.name}</span>
                        <span className="block text-[11px] text-g400">
                          {ROLE[c.role] ?? c.role}
                          {c.firstDay ? ` · зміни з ${ddmmyyyy(c.firstDay)}` : " · змін немає"}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs text-g500">{c.label ?? "не вказано"}</td>
                      <td className="px-2 py-2">
                        <input className={CELL} value={r.make} onChange={(e) => upd(c.userId, { make: e.target.value })} aria-label="Марка" />
                      </td>
                      <td className="px-2 py-2">
                        <input className={CELL} value={r.model} onChange={(e) => upd(c.userId, { model: e.target.value })} aria-label="Модель" />
                      </td>
                      <td className="px-2 py-2">
                        <input
                          className={CELL}
                          value={r.plate}
                          onChange={(e) => upd(c.userId, { plate: e.target.value })}
                          placeholder="ВС1234АК"
                          aria-label="Номер"
                        />
                      </td>
                      <td className="px-2 py-2">
                        <select
                          className={CELL}
                          value={r.ownership}
                          onChange={(e) => upd(c.userId, { ownership: e.target.value as Row["ownership"] })}
                          aria-label="Чия машина"
                        >
                          <option value="COMPANY">авто фірми</option>
                          <option value="PERSONAL">авто торгового</option>
                        </select>
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-g600">
                        {c.odometerKm != null ? (
                          <>
                            {num(c.odometerKm)} км
                            {c.odometerDay && <span className="block text-[11px] text-g400">{ddmmyyyy(c.odometerDay)}</span>}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
          <p className="mt-2 text-[11px] text-g500">
            Машину закріплюємо за людиною з її першої зміни — тож кілометраж за минулі місяці теж ляже на цю машину.
            Номер можна дописати пізніше в картці.
          </p>
          {err && <p className="mt-2 text-sm text-[#B91C1C]">{err}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" className={BTN_PRIMARY} disabled={busy || picked.length === 0} onClick={run}>
              {busy ? "Переношу…" : `Перенести вибрані (${picked.length})`}
            </button>
          </div>
        </>
      )}
    </Card>
  );
}
