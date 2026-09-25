/** Як назвати машину людині: номер, а без нього — марка й модель. */
export function vehicleTitle(v: { plate: string | null; make: string; model: string }): string {
  return v.plate ?? `${v.make} ${v.model}`.trim();
}

export const OWNERSHIP_LABEL = { COMPANY: "авто фірми", PERSONAL: "авто торгового" } as const;
