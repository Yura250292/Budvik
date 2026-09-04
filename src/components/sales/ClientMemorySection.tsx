"use client";

/**
 * Памʼять про клієнта на його картці.
 *
 * Те, чого немає в жодному документі: чому не платить, з ким говорити, що
 * принципово не бере, коли приймає товар. Досі це жило в голові в того,
 * хто веде точку, і зникало разом із відпусткою чи звільненням.
 *
 * Чому не в стрічці коментарів: коментар — це подія на дату («заїжджав,
 * зачинено»), і його дописують знизу. Факт живе далі, його правлять, і
 * саме його треба прочитати за секунду перед дверима магазину.
 *
 * Той самий список читає помічник, коли готує розмову з клієнтом, — і
 * дописує сюди, коли торговий прямо просить запамʼятати. Тому джерело
 * запису видно на кожному рядку: довіра до «сказав торговий» і до
 * «записав помічник» різна.
 */

import { useState } from "react";
import { Brain, Sparkles } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { useApi } from "@/components/ui/useApi";
import { useProfile } from "@/lib/useProfile";
import { Body, Note, Pill } from "@/components/cabinet/ui";
import { Section, SectionRow } from "@/components/sales/ClientSection";
import { formatDate } from "@/lib/utils";

type Kind = "PAYMENT" | "RELATIONSHIP" | "PREFERENCE" | "LOGISTICS" | "COMPETITOR" | "OTHER";

const KIND_LABELS: Record<Kind, string> = {
  PAYMENT: "Оплата",
  RELATIONSHIP: "Стосунки",
  PREFERENCE: "Уподобання",
  LOGISTICS: "Логістика",
  COMPETITOR: "Конкуренти",
  OTHER: "Інше",
};

const KIND_ORDER: Kind[] = [
  "PAYMENT",
  "RELATIONSHIP",
  "PREFERENCE",
  "LOGISTICS",
  "COMPETITOR",
  "OTHER",
];

type Fact = {
  id: string;
  kind: Kind;
  text: string;
  source: "REP" | "ASSISTANT";
  author: { id: string; name: string } | null;
  createdAt: string;
  canEdit: boolean;
};

const FIELD =
  "w-full rounded-xl border border-cab-line bg-white px-3 py-2.5 text-base text-bk outline-none focus:border-bk";

export default function ClientMemorySection({
  counterpartyId,
  clientName,
}: {
  counterpartyId: string;
  clientName: string;
}) {
  const { data, reload } = useApi<{ facts: Fact[] }>(
    `/api/sales/client-memory/${counterpartyId}`
  );
  const profile = useProfile();
  const facts = data?.facts ?? [];

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (
    url: string,
    method: "POST" | "PATCH",
    body: { kind: Kind; text: string }
  ) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? "Не вдалося зберегти");
      setAdding(false);
      setEditing(null);
      reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/sales/client-memory/item/${id}`, { method: "DELETE" });
      reload();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <Section
      title="Памʼять про клієнта"
      icon={<Brain size={18} className="text-cab-t2" />}
      right={
        facts.length > 0 ? (
          <span className="shrink-0 text-[13px] font-semibold text-cab-t2">{facts.length}</span>
        ) : undefined
      }
    >
      <div className="px-4 pt-2.5">
        <Note>
          Що клієнт за людина, чому не платить, з ким говорити. Помічник теж читає й дописує сюди.
        </Note>
      </div>

      {facts.length === 0 && !adding && (
        <div className="px-4 py-3">
          <Body>
            Записів ще немає. Додайте перше спостереження — воно допоможе і вам, і помічнику.
          </Body>
        </div>
      )}

      {facts.map((f) =>
        editing === f.id ? (
          <SectionRow key={f.id}>
            <MemoryForm
              initial={f}
              busy={busy}
              onCancel={() => setEditing(null)}
              onSave={(body) => save(`/api/sales/client-memory/item/${f.id}`, "PATCH", body)}
            />
          </SectionRow>
        ) : (
          <SectionRow key={f.id}>
            <span className="flex flex-wrap items-center gap-2">
              <Pill tone="neutral">{KIND_LABELS[f.kind]}</Pill>
              {f.source === "ASSISTANT" ? (
                <Pill tone="info">
                  <Sparkles size={11} /> помічник
                </Pill>
              ) : (
                <span className="text-[11px] text-cab-t3">{f.author?.name ?? "—"}</span>
              )}
              <span className="text-[11px] text-cab-t3">{formatDate(f.createdAt)}</span>
            </span>
            <span className="mt-1 block whitespace-pre-wrap text-sm text-bk">{f.text}</span>

            {f.canEdit && (
              <span className="mt-1.5 flex gap-3">
                <button
                  type="button"
                  onClick={() => setEditing(f.id)}
                  className="text-xs font-semibold text-cab-t2"
                >
                  Змінити
                </button>
                {confirming === f.id ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(f.id)}
                    className="text-xs font-bold text-bad-fg"
                  >
                    Точно видалити?
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirming(f.id)}
                    className="text-xs font-semibold text-bad-fg"
                  >
                    Видалити
                  </button>
                )}
              </span>
            )}
          </SectionRow>
        )
      )}

      {error && (
        <div className="px-4 pb-1">
          <Note tone="bad">{error}</Note>
        </div>
      )}

      {adding ? (
        <SectionRow>
          <MemoryForm
            busy={busy}
            onCancel={() => setAdding(false)}
            onSave={(body) => save(`/api/sales/client-memory/${counterpartyId}`, "POST", body)}
          />
        </SectionRow>
      ) : (
        <SectionRow>
          <button
            type="button"
            onClick={() => setAdding(true)}
            disabled={!profile}
            className="text-sm font-semibold text-bk"
          >
            + Додати запис
          </button>
        </SectionRow>
      )}

      <SectionRow
        href={`/sales/assistant?client=${counterpartyId}&name=${encodeURIComponent(clientName)}`}
      >
        <span className="flex items-center gap-2">
          <Sparkles size={16} className="text-cab-t2" />
          <span className="flex-1 text-sm font-medium text-bk">Спитати помічника про клієнта</span>
          <ChevronRight size={16} className="text-cab-t3" />
        </span>
      </SectionRow>
    </Section>
  );
}

function MemoryForm({
  initial,
  busy,
  onCancel,
  onSave,
}: {
  initial?: { kind: Kind; text: string };
  busy: boolean;
  onCancel: () => void;
  onSave: (body: { kind: Kind; text: string }) => void;
}) {
  const [kind, setKind] = useState<Kind>(initial?.kind ?? "OTHER");
  const [text, setText] = useState(initial?.text ?? "");

  return (
    <span className="flex flex-col gap-2 py-1">
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
        className={`${FIELD} h-11`}
      >
        {KIND_ORDER.map((k) => (
          <option key={k} value={k}>
            {KIND_LABELS[k]}
          </option>
        ))}
      </select>
      <textarea
        rows={2}
        value={text}
        maxLength={500}
        onChange={(e) => setText(e.target.value)}
        placeholder="Напр.: платить лише готівкою після 15-го; директор Ігор, торгується; SIGMA бере в конкурента"
        className={`${FIELD} resize-none`}
      />
      <span className="flex gap-2">
        <button
          type="button"
          disabled={busy || text.trim().length < 3}
          onClick={() => onSave({ kind, text: text.trim() })}
          className="h-11 flex-1 rounded-xl bg-bk px-3 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {initial ? "Зберегти" : "Додати"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-11 rounded-xl border border-cab-line px-4 text-[13px] font-semibold text-cab-t2"
        >
          Скасувати
        </button>
      </span>
    </span>
  );
}
