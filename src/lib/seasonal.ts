/**
 * Seasonal logic for Lviv, Ukraine.
 * Determines current season and provides auto-recommendations.
 */

export type Season = "winter" | "spring" | "summer" | "autumn";

export function getCurrentSeason(): Season {
  const month = new Date().getMonth(); // 0-11
  if (month >= 2 && month <= 4) return "spring";  // Mar-May
  if (month >= 5 && month <= 7) return "summer";   // Jun-Aug
  if (month >= 8 && month <= 10) return "autumn";  // Sep-Nov
  return "winter";                                  // Dec-Feb
}

export function getSeasonLabel(season: Season): string {
  const labels: Record<Season, string> = {
    spring: "Весна",
    summer: "Літо",
    autumn: "Осінь",
    winter: "Зима",
  };
  return labels[season];
}

export function getSeasonIcon(season: Season): string {
  const icons: Record<Season, string> = {
    spring: "🌱",
    summer: "☀️",
    autumn: "🍂",
    winter: "❄️",
  };
  return icons[season];
}

export function getSeasonColor(season: Season): string {
  const colors: Record<Season, string> = {
    spring: "#22C55E",
    summer: "#F59E0B",
    autumn: "#EA580C",
    winter: "#3B82F6",
  };
  return colors[season];
}

/** Default seasonal keywords for auto-recommendation when no admin promos exist */
export const DEFAULT_SEASONAL_KEYWORDS: Record<Season, string[]> = {
  spring: [
    "газонокосарк", "тример", "обприскувач", "лопат", "граблі", "секатор",
    "шланг", "насос", "компресор", "фарб", "валик", "пензл", "шпатель",
    "дриль", "перфоратор", "болгарк",
  ],
  summer: [
    "тример", "газонокосарк", "бензопил", "електропил", "генератор",
    "насос", "шланг", "обприскувач", "вентилятор", "кондиціонер",
    "рівень", "рулетк", "набір інструмент",
  ],
  autumn: [
    "бензопил", "електропил", "повітродув", "генератор",
    "обігрівач", "тепловентилятор", "зварюванн",
    "утеплювач", "герметик", "монтажна піна",
  ],
  winter: [
    "обігрівач", "тепловентилятор", "генератор", "ліхтар", "акумулятор",
    "зварюванн", "шуруповерт", "набір біт", "набір головок",
    "ключ", "викрутк", "набір інструмент",
  ],
};
