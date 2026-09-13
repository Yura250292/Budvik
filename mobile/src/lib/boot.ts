/**
 * Хід запуску робочої збірки — те, що показує заставка (ui/BootScreen.tsx).
 *
 * Навіщо окреме сховище. Від нативного сплешу до першого вмісту кабінету
 * застосунок проходить три різні екрани: замок (біометрія), розвилку
 * «вітрина чи кабінет» і сам кабінет із WebView. Кожен із них знає лише про
 * свій шматок шляху, а заставка має бути ОДНА й неперервна — три окремі
 * заглушки перезапускали б анімацію на кожному стику, і логотип смикався б.
 * Тому екрани лише доповідають, де вони, а шар-заставка слухає — тим самим
 * механізмом, що й `onScopeChange` в auth-store.
 *
 * Хід монотонний: WebView на 302 (сесія → кабінет) починає рахувати
 * завантаження заново, і смуга, що відкочується назад, читається людиною як
 * поломка. Тому нове значення береться лише більше за попереднє.
 *
 * Стеля в 20 секунд — запобіжник. Заставка не має права замкнути людину:
 * краще показати недовантажений кабінет, ніж вічний логотип на планшеті в
 * машині без зв'язку.
 *
 * Активний стан від самого завантаження модуля, а не з першого ефекту: на
 * Android нативний сплеш ховається БЕЗ переходу, і будь-який кадр між ним і
 * заставкою видно як блимання. Перший кадр JS уже мусить бути заставкою.
 */

import { IS_STAFF_BUILD } from "@/lib/flavor";

export type BootStage = "start" | "unlock" | "scope" | "token" | "page" | "ready";

export type BootState = Readonly<{
  /** Чи показувати заставку. Після `bootDone` — false, і всі доповіді no-op. */
  active: boolean;
  /** 0..1, ніколи не зменшується в межах одного запуску. */
  progress: number;
  stage: BootStage;
}>;

/** Порядок етапів: доповідь про давніший етап не відкочує підпис назад. */
const ORDER: readonly BootStage[] = ["start", "unlock", "scope", "token", "page", "ready"];

/** Скільки заставка може висіти, що б не відбувалося під нею. */
export const BOOT_CAP_MS = 20_000;

type Listener = (state: BootState) => void;
const listeners = new Set<Listener>();

let state: BootState = Object.freeze({
  active: IS_STAFF_BUILD,
  progress: 0,
  stage: "start" as BootStage,
});

let capTimer: ReturnType<typeof setTimeout> | null = null;

function commit(next: BootState) {
  state = Object.freeze(next);
  for (const fn of listeners) fn(state);
}

function armCap() {
  if (capTimer) clearTimeout(capTimer);
  capTimer = setTimeout(() => {
    capTimer = null;
    bootDone();
  }, BOOT_CAP_MS);
}

/**
 * Показати заставку, якщо її ще немає, і перезавести стелю.
 *
 * Кличе кабінет при монтажі: після входу він з'являється вже після того, як
 * заставка холодного старту пішла, і WebView знову вантажиться з нуля. На
 * холодному старті виклик ідемпотентний — заставка й так активна, лише
 * стеля відлічує заново від справжнього початку завантаження сторінки.
 *
 * У збірці магазину — нічого: там заставки немає взагалі.
 */
export function bootBegin(): void {
  if (!IS_STAFF_BUILD) return;
  armCap();
  if (state.active) return;
  commit({ active: true, progress: 0, stage: "start" });
}

/**
 * Доповідь про етап. `fraction` — частка шляху 0..1; без неї змінюється лише
 * підпис. Після `bootDone` — тиша: пізніші завантаження WebView (перехід по
 * кабінету, повернення зі «Зміни») заставки не стосуються.
 */
export function bootReport(stage: BootStage, fraction?: number): void {
  if (!state.active) return;
  const nextStage = ORDER.indexOf(stage) > ORDER.indexOf(state.stage) ? stage : state.stage;
  const nextProgress =
    fraction === undefined ? state.progress : Math.max(state.progress, Math.min(1, fraction));
  if (nextStage === state.stage && nextProgress === state.progress) return;
  commit({ active: true, progress: nextProgress, stage: nextStage });
}

/**
 * Вміст на екрані — заставка йде. Кличуть: сторінка кабінету (через міст),
 * запасний таймер після onLoadEnd, помилка WebView, замок, що не відкрився,
 * розвилка, яка веде на вітрину чи вхід, і стеля.
 */
export function bootDone(): void {
  if (!state.active) return;
  if (capTimer) {
    clearTimeout(capTimer);
    capTimer = null;
  }
  commit({ active: false, progress: 1, stage: "ready" });
}

export function onBoot(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Те саме посилання до наступної зміни — так вимагає useSyncExternalStore. */
export function bootSnapshot(): BootState {
  return state;
}

if (IS_STAFF_BUILD) armCap();
