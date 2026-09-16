"use client";

/**
 * Пропозиція клієнту на його картці.
 *
 * Сайт не має каналу до клієнта, а в торгового є телефон, Viber і знайомство.
 * Тут торговий обирає привід, отримує короткий готовий текст із 2–3 товарами,
 * що є на складі, з оптовою ціною, правує його і відправляє зі свого
 * пристрою. Сайт лише записує, що і кому пішло.
 *
 * Посилання на каталог — лише галочкою: на вітрині роздрібні ціни, вищі за
 * опт у тексті, і клієнт 1С прочитав би їх як подорожчання.
 *
 * Порядок на дотик: спершу запис (fetch з keepalive), одразу слідом —
 * відкриття Viber/Telegram/SMS. Не «дочекатися запису»: між дотиком і
 * відкриттям месенджера не має бути ні секунди, а збій журналу не має
 * заважати відправці. Не вийшло записати — попередження, і все.
 */

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { MessageSquareText } from "lucide-react";
import { useApi } from "@/components/ui/useApi";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { Body, Note, Pill } from "@/components/cabinet/ui";
import { Section, SectionRow } from "@/components/sales/ClientSection";
import { CLIENT_STATE } from "@/lib/analytics/colors";
import type { KindOption } from "@/lib/outreach/compose";
import { findInventedDiscount, formatUah, kindHasLink } from "@/lib/outreach/templates";
import {
  MAX_OFFER_CHARS,
  OUTREACH_CHANNELS,
  OUTREACH_KINDS,
  OUTREACH_OUTCOMES,
  isOutreachKind,
  labelOf,
  type ComposedOffer,
  type MarketingConsent,
  type OutreachChannel,
  type OutreachKind,
  type OutreachRow,
  type PreferredChannel,
} from "@/lib/outreach/types";

type ComposeResponse = {
  offer: ComposedOffer | null;
  kinds: KindOption[];
  client: {
    id: string;
    name: string;
    displayName: string;
    marketingConsent: MarketingConsent;
    marketingConsentAt: string | null;
    marketingOptOutAt: string | null;
    preferredChannel: PreferredChannel | null;
  };
};

type HistoryItem = OutreachRow & { canEdit: boolean };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
  return json as T;
}

/** Мітка стану клієнта: кольором CLIENT_STATE, як на карті, але словом для одного клієнта. */
const STATE_WORD: Record<string, string> = {
  NEW: "новий",
  ACTIVE: "активний",
  SLIPPING: "згасає",
  DORMANT: "спить",
  LOST: "втрачений",
};

export function ClientStatePill({ state }: { state: string | null | undefined }) {
  if (!state || !(state in CLIENT_STATE)) return null;
  const color = CLIENT_STATE[state as keyof typeof CLIENT_STATE].color;
  // Колір — на крапці й тлі, текст темний: жовтий «згасає» текстом на білому не читається.
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold text-bk"
      style={{ background: `${color}1F` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {STATE_WORD[state] ?? state}
    </span>
  );
}

const OUTCOME_TONE: Record<string, "ok" | "warn" | "bad" | "info" | "neutral"> = {
  PENDING: "neutral",
  ORDERED: "ok",
  REPLIED: "info",
  REFUSED: "bad",
  NO_ANSWER: "warn",
  OPT_OUT: "bad",
};

/** Канали, які торговий відмічає щодо клієнта: «Не турбувати» — окремою кнопкою згоди. */
const CHANNEL_CHOICES: Array<{ key: PreferredChannel; label: string }> = [
  { key: "VIBER", label: "Viber" },
  { key: "TELEGRAM", label: "Telegram" },
  { key: "SMS", label: "SMS" },
  { key: "PHONE_CALL", label: "Дзвінок" },
];

function when(iso: string): string {
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Вид із якоря: `#offer-DEBT` зі списку «кому написати» відкриває одразу потрібний. */
function kindFromHash(): OutreachKind | null {
  if (typeof window === "undefined") return null;
  const m = window.location.hash.match(/^#offer-([A-Z_]+)$/);
  return m && isOutreachKind(m[1]) ? m[1] : null;
}

/** Рядок із посиланням прибираємо для Telegram: той сам ставить url першим, і вийшло б двічі. */
function withoutLinkLine(text: string, link: string | null): string {
  if (!link) return text;
  return text
    .split("\n")
    .filter((line) => line.trim() !== link)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

const chipCls = (on: boolean, off: boolean) =>
  `inline-flex items-center rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors ${
    on ? "border-bk bg-bk text-white" : "border-cab-line bg-white text-cab-t2"
  } ${off ? "opacity-50" : ""}`;

const actionCls =
  "flex h-11 items-center justify-center rounded-xl px-3 text-center text-[13px] font-semibold active:opacity-80";

type Draft = {
  key: string;
  text: string;
  /** Посилання й токен, з якими складено саме цей текст, — вони їдуть у запис. */
  link: string | null;
  linkToken: string | null;
  productIds: string[];
};

export default function ClientOfferSection({ counterpartyId }: { counterpartyId: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lastLog = useRef<{ sig: string; at: number } | null>(null);
  const isApp = useIsNativeApp();

  const [kind, setKind] = useState<OutreachKind | null>(kindFromHash);
  const [variant, setVariant] = useState<number | null>(null);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoInput, setPromoInput] = useState("");
  const [promoText, setPromoText] = useState("");
  const [withLink, setWithLink] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState<{ tone?: "warn" | "bad"; text: string } | null>(null);
  const [hintKind, setHintKind] = useState<OutreachKind | null>(null);

  // Картка вантажиться після переходу, тож рідний перехід до #offer промахується:
  // гортаємо самі, коли секція вже на екрані.
  useEffect(() => {
    if (window.location.hash.startsWith("#offer")) anchor.current?.scrollIntoView({ block: "start" });
  }, []);

  const params = new URLSearchParams({ counterpartyId });
  if (kind) params.set("kind", kind);
  if (variant != null) params.set("variant", String(variant));
  if (promoText) params.set("promoText", promoText);
  if (withLink) params.set("link", "1");

  /**
   * Без автоматичного перезапиту: кожна відповідь несе новий токен посилання,
   * і текст, що змінився сам, поки торговий ходив у Viber, — це вже інша
   * пропозиція, ніж та, яку він надіслав.
   */
  const { data, error, isLoading, mutate } = useSWR<ComposeResponse>(
    `/api/sales/outreach/compose?${params}`,
    fetchJson,
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false, keepPreviousData: true }
  );
  const history = useApi<{ items: HistoryItem[] }>(`/api/sales/outreach?counterpartyId=${counterpartyId}`);

  const offer = data?.offer ?? null;
  // Галочка посилання — у ключі: правка тексту без посилання не має тихо
  // поїхати клієнту разом із токеном від тексту з посиланням, і навпаки.
  const offerKey = offer ? `${offer.kind}:${offer.variant}:${promoText}:${withLink}` : "";
  const own = draft && draft.key === offerKey ? draft : null;
  const text = own ? own.text : (offer?.text ?? "");
  const basis = own ?? {
    link: offer?.link ?? null,
    linkToken: offer?.linkToken ?? null,
    productIds: offer?.products.map((p) => p.id) ?? [],
  };

  const activeKind = offer?.kind ?? kind;
  const phoneE164 = offer?.phone.e164 ?? null;
  const discountWord = offer ? findInventedDiscount(text, offer.kind, promoText) : null;

  /**
   * SMS у застосунку — лише коли застосунок сам каже, що відкриє sms:.
   *
   * Білий список зовнішніх адрес у WebView доїжджає оновленням повітрям, а міст
   * повідомляє лише версію оболонки — за нею не видно, чи оновлення вже стоїть.
   * Кнопка, яка нічого не робить, гірша за відсутню: торговий вирішить, що SMS
   * пішло. Тому в застосунку SMS з'явиться, коли міст отримає canOpenUrl.
   */
  const bridge =
    isApp && typeof window !== "undefined"
      ? (window.BudvikApp as { canOpenUrl?: (url: string) => boolean } | undefined)
      : undefined;
  const smsAvailable = !!phoneE164 && (!isApp || bridge?.canOpenUrl?.("sms:") === true);

  const log = (channel: OutreachChannel) => {
    if (!offer) return;
    const sig = `${channel}:${basis.linkToken ?? ""}:${text}`;
    const last = lastLog.current;
    // Подвійний дотик по тій самій кнопці — одна відправка, а не дві.
    if (last && last.sig === sig && Date.now() - last.at < 120_000) return;
    lastLog.current = { sig, at: Date.now() };

    setNote(null);
    fetch("/api/sales/outreach", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        counterpartyId,
        kind: offer.kind,
        channel,
        text,
        productIds: basis.productIds,
        linkToken: basis.linkToken,
      }),
    })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? `помилка ${res.status}`);
        setNote({
          text: json?.duplicate
            ? "Цю пропозицію вже записано в історію."
            : `Записано в історію: ${labelOf(OUTREACH_CHANNELS, channel)}.`,
        });
        history.reload();
      })
      .catch((e: Error) => {
        lastLog.current = null;
        setNote({
          tone: "warn",
          text: `Відправку не записано в історію (${e.message}). Повідомлення це не зупиняє.`,
        });
      });
  };

  const copy = async () => {
    log("COPY");
    try {
      await navigator.clipboard.writeText(text);
      setNote({ text: "Скопійовано — вставте в месенджер." });
    } catch {
      // У WebView без https чи дозволу буфер недоступний — лишаємо старий шлях.
      textarea.current?.select();
      const ok = document.execCommand?.("copy");
      setNote(ok ? { text: "Скопійовано — вставте в месенджер." } : { tone: "warn", text: "Не вдалося скопіювати: виділіть текст вручну." });
    }
  };

  const setOutcome = async (item: HistoryItem, outcome: string) => {
    const next = item.outcome === outcome ? "PENDING" : outcome;
    try {
      const res = await fetch(`/api/sales/outreach/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome: next }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `помилка ${res.status}`);
      history.reload();
      // «Просить не писати» міняє згоду клієнта — попередження над текстом теж.
      if (next === "OPT_OUT") void mutate();
    } catch (e) {
      setNote({ tone: "warn", text: `Не вдалося позначити: ${(e as Error).message}` });
    }
  };

  const saveConsent = async (body: { marketingConsent?: MarketingConsent; preferredChannel?: PreferredChannel | null }) => {
    try {
      const res = await fetch(`/api/sales/clients/${counterpartyId}/consent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `помилка ${res.status}`);
      void mutate();
    } catch (e) {
      setNote({ tone: "warn", text: `Не вдалося зберегти: ${(e as Error).message}` });
    }
  };

  const pickKind = (k: KindOption) => {
    if (k.key === "PROMO") {
      setPromoOpen((v) => !v);
      setHintKind(null);
      if (!k.available) return;
    } else if (!k.available) {
      setHintKind(hintKind === k.key ? null : k.key);
      return;
    }
    setHintKind(null);
    setKind(k.key);
    setVariant(null);
  };

  const kinds = data?.kinds ?? OUTREACH_KINDS.map((k) => ({ ...k, available: true }) as KindOption);
  const items = history.data?.items ?? [];
  const client = data?.client;
  const hint = hintKind ? kinds.find((k) => k.key === hintKind) : null;
  const tgHref = `https://t.me/share/url?url=${encodeURIComponent(basis.link ?? " ")}&text=${encodeURIComponent(
    withoutLinkLine(text, basis.link)
  )}`;
  const over = text.length > MAX_OFFER_CHARS;

  return (
    <div id="offer" ref={anchor} className="scroll-mt-20">
      <Section
        title="Пропозиція клієнту"
        icon={<MessageSquareText size={18} className="text-cab-t2" />}
        right={
          offer ? <span className="shrink-0 text-[13px] font-semibold text-cab-t2">{labelOf(OUTREACH_KINDS, offer.kind)}</span> : undefined
        }
      >
        <div className="flex flex-col gap-2.5 px-4 py-3">
          <div className="flex flex-wrap gap-1.5">
            {kinds.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => pickKind(k)}
                aria-pressed={activeKind === k.key}
                title={k.reason ?? k.hint}
                className={chipCls(activeKind === k.key, !k.available)}
              >
                {k.label}
              </button>
            ))}
          </div>
          {hint?.reason && <Note>{`«${hint.label}» недоступно: ${hint.reason}.`}</Note>}

          {promoOpen && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-cab-bg p-2.5">
              <Note>Умови акції — лише ті, що офіс уже проставив у 1С. Сайт знижок не вигадує і не ставить.</Note>
              <textarea
                value={promoInput}
                onChange={(e) => setPromoInput(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="Напр.: до 30.09 при замовленні від 5 ящиків — доставка за наш рахунок"
                className="w-full rounded-xl border border-cab-line bg-white px-3 py-2 text-base text-bk outline-none focus:border-bk"
              />
              <button
                type="button"
                disabled={!promoInput.trim()}
                onClick={() => {
                  setPromoText(promoInput.trim());
                  setKind("PROMO");
                  setVariant(null);
                }}
                className="h-10 rounded-xl bg-bk text-[13px] font-semibold text-white disabled:opacity-50"
              >
                Скласти текст акції
              </button>
            </div>
          )}

          {error && !data ? (
            <div className="flex items-center justify-between gap-2">
              <Note tone="bad">{(error as Error).message}</Note>
              <button type="button" onClick={() => void mutate()} className="text-xs font-semibold text-bk">
                Ще раз
              </button>
            </div>
          ) : isLoading && !data ? (
            <Body>Складаю пропозицію…</Body>
          ) : offer ? (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <ClientStatePill state={offer.state} />
                <span className="text-[13px] text-cab-t2">{offer.reason}</span>
              </span>

              {offer.warnings.map((w) => (
                <Note key={w} tone="warn">
                  {w}
                </Note>
              ))}

              <textarea
                ref={textarea}
                value={text}
                onChange={(e) =>
                  setDraft({
                    key: offerKey,
                    text: e.target.value,
                    link: basis.link,
                    linkToken: basis.linkToken,
                    productIds: basis.productIds,
                  })
                }
                rows={9}
                // 16px: дрібніше — і iOS зумить сторінку при фокусі.
                className="w-full rounded-xl border border-cab-line bg-white px-3 py-2.5 text-base leading-snug text-bk outline-none focus:border-bk"
                aria-label="Текст пропозиції"
              />
              <span className="flex items-center justify-between gap-2">
                <span className={`text-xs tabular-nums ${over ? "text-warn-fg" : "text-cab-t3"}`}>
                  {text.length} / {MAX_OFFER_CHARS}
                  {over ? " — довше за два екрани Viber" : ""}
                </span>
                <span className="flex gap-3">
                  {own && (
                    <button type="button" onClick={() => setDraft(null)} className="text-xs font-semibold text-cab-t2">
                      Повернути текст
                    </button>
                  )}
                  {offer.variants > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setKind(offer.kind);
                        setVariant((offer.variant + 1) % offer.variants);
                        setDraft(null);
                      }}
                      className="text-xs font-semibold text-bk"
                    >
                      Інший варіант
                    </button>
                  )}
                </span>
              </span>
              {discountWord && offer.kind !== "PROMO" && (
                <Note tone="warn">
                  {`У тексті «${discountWord}». Ціни й знижки ставить 1С — перш ніж обіцяти, узгодьте з офісом.`}
                </Note>
              )}

              {kindHasLink(offer.kind) && (
                <label className="flex items-start gap-2.5 rounded-xl bg-cab-bg px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={withLink}
                    onChange={(e) => setWithLink(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-bk"
                  />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium text-bk">Додати посилання на каталог</span>
                    <span className="block text-[11px] text-cab-t3">на сайті роздрібні ціни, вищі за ваш опт</span>
                  </span>
                </label>
              )}

              {offer.products.length > 0 && (
                <div className="flex flex-col divide-y divide-[#F1F1EF] rounded-xl border border-cab-line">
                  {offer.products.map((p) => (
                    <div key={p.id} className="px-3 py-2">
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0 text-[13px] font-medium text-bk">{p.name}</span>
                        <span className="shrink-0 text-right text-[13px] font-semibold tabular-nums text-bk">
                          {p.wholesalePrice ? `${formatUah(p.wholesalePrice)} опт` : "без опту"}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] text-cab-t3">
                        {[p.sku ? `арт. ${p.sku}` : null, `вільно ${p.freeStock} шт`, p.why].filter(Boolean).join(" · ")}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`viber://forward?text=${encodeURIComponent(text)}`}
                  onClick={() => log("VIBER")}
                  className={`${actionCls} bg-[#7360F2] text-white`}
                >
                  Viber
                </a>
                <a
                  href={tgHref}
                  onClick={() => log("TELEGRAM")}
                  // У браузері — нова вкладка, щоб не піти з картки; у застосунку
                  // адресу перехоплює WebView і віддає системі.
                  target={isApp ? undefined : "_blank"}
                  rel="noreferrer"
                  className={`${actionCls} bg-[#229ED9] text-white`}
                >
                  Telegram
                </a>
                {smsAvailable && (
                  <a
                    href={`sms:${phoneE164}?body=${encodeURIComponent(text)}`}
                    onClick={() => log("SMS")}
                    className={`${actionCls} border border-cab-line bg-white text-bk`}
                  >
                    SMS
                  </a>
                )}
                <button type="button" onClick={() => void copy()} className={`${actionCls} bg-primary text-bk`}>
                  Скопіювати
                </button>
                <button
                  type="button"
                  onClick={() => log("CALL")}
                  className={`${actionCls} border border-cab-line bg-white text-bk ${smsAvailable ? "col-span-2" : ""}`}
                >
                  Подзвонив
                </button>
              </div>
              {note && <Note tone={note.tone}>{note.text}</Note>}
            </>
          ) : null}
        </div>

        {client && (
          <SectionRow>
            <span className="block text-xs font-semibold text-cab-t2">Як клієнт хоче отримувати</span>
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={client.marketingConsent === "GRANTED"}
                onClick={() =>
                  void saveConsent({ marketingConsent: client.marketingConsent === "GRANTED" ? "UNKNOWN" : "GRANTED" })
                }
                className={chipCls(client.marketingConsent === "GRANTED", false)}
              >
                Згоден отримувати повідомлення
              </button>
              <button
                type="button"
                aria-pressed={client.marketingConsent === "REFUSED"}
                onClick={() =>
                  void saveConsent({ marketingConsent: client.marketingConsent === "REFUSED" ? "UNKNOWN" : "REFUSED" })
                }
                className={chipCls(client.marketingConsent === "REFUSED", false)}
              >
                Не писати
              </button>
            </span>
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {CHANNEL_CHOICES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  aria-pressed={client.preferredChannel === c.key}
                  onClick={() => void saveConsent({ preferredChannel: client.preferredChannel === c.key ? null : c.key })}
                  className={chipCls(client.preferredChannel === c.key, false)}
                >
                  {c.label}
                </button>
              ))}
            </span>
          </SectionRow>
        )}

        {items.length > 0 && (
          <>
            <div className="border-t border-cab-line px-4 pb-1 pt-3">
              <span className="text-xs font-semibold text-cab-t2">Історія пропозицій</span>
            </div>
            {items.map((item) => (
              <SectionRow key={item.id}>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[13px] font-medium text-bk">{when(item.sentAt)}</span>
                  <Pill tone="neutral">{labelOf(OUTREACH_CHANNELS, item.channel)}</Pill>
                  <span className="text-[11px] text-cab-t3">
                    {[labelOf(OUTREACH_KINDS, item.kind), item.repName].filter(Boolean).join(" · ")}
                  </span>
                  {item.clickedAt && <Pill tone="info">{`відкрив ${when(item.clickedAt)}`}</Pill>}
                  {item.outcomeBy === "WORKER" && item.outcomeAmount != null && (
                    <span className="text-[11px] text-ok-fg">{formatUah(item.outcomeAmount)}</span>
                  )}
                </span>
                {!!item.text && (
                  <span className="mt-1 line-clamp-2 block whitespace-pre-line text-xs text-cab-t2">{item.text}</span>
                )}
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {OUTREACH_OUTCOMES.filter((o) => o.key !== "PENDING").map((o) =>
                    item.canEdit ? (
                      <button
                        key={o.key}
                        type="button"
                        aria-pressed={item.outcome === o.key}
                        onClick={() => void setOutcome(item, o.key)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                          item.outcome === o.key ? "border-bk bg-bk text-white" : "border-cab-line bg-white text-cab-t2"
                        }`}
                      >
                        {o.label}
                      </button>
                    ) : item.outcome === o.key ? (
                      <Pill key={o.key} tone={OUTCOME_TONE[o.key]}>
                        {o.label}
                      </Pill>
                    ) : null
                  )}
                </span>
              </SectionRow>
            ))}
          </>
        )}
      </Section>
    </div>
  );
}
