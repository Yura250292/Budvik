/**
 * Кольори торгових на мапі напрямків.
 *
 * Колір може бути заданий вручну (User.color), але поки менеджер його не
 * обрав, потрібен стабільний дефолт. Беремо хеш від id, а не індекс у списку:
 * список сортується за іменем і фільтрується, тож індекс змінював би колір
 * торгового щоразу, як у команду додають нову людину.
 */

export const REP_PALETTE = [
  "#2563EB", // синій
  "#DC2626", // червоний
  "#16A34A", // зелений
  "#9333EA", // фіолетовий
  "#EA580C", // помаранчевий
  "#0D9488", // бірюзовий
  "#DB2777", // рожевий
  "#65A30D", // оливковий
  "#0891B2", // блакитний
  "#B45309", // коричневий
] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value.trim());
}

/** Явний колір торгового або детермінований із палітри. */
export function colorForRep(repId: string, explicit?: string | null): string {
  if (isHexColor(explicit)) return explicit.trim();

  let hash = 0;
  for (let i = 0; i < repId.length; i++) {
    hash = (hash * 31 + repId.charCodeAt(i)) >>> 0;
  }
  return REP_PALETTE[hash % REP_PALETTE.length];
}
