export type Tab = {
  id: string;
  path: string;
  title: string;
  iconKey: string;
  pinned?: boolean;
  createdAt: number;
  lastActiveAt: number;
  /** Бампається кнопкою «Оновити» — використовується в React key для перемонтування. */
  reloadKey?: number;
};

export type TabsState = {
  tabs: Tab[];
  activeTabId: string | null;
};

/** Більше вкладок не тримаємо змонтованими: пам'ять і так росте лінійно. */
export const TAB_CAP = 12;

/** Вкладки старші за тиждень не відновлюємо — це вже не «робоча сесія». */
export const TAB_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const TABS_STORAGE_PREFIX = "budvik:admin:tabs:v1";

export function storageKey(userId: string | undefined) {
  return `${TABS_STORAGE_PREFIX}:${userId ?? "anon"}`;
}

export function makeTabId(path: string) {
  return `${path}::${Math.random().toString(36).slice(2, 9)}`;
}
