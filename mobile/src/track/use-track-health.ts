/**
 * Стежить за живістю запису, поки застосунок відкритий.
 *
 * Це єдиний шлях перевірки, який не залежить від мережі й від системного
 * планувальника: він працює рівно тоді, коли процес живий. Разом із перевіркою
 * при поверненні застосунку на екран цього досить, щоб зависла підписка не
 * тривала годинами — у водія планшет у тримачі й екран увімкнений, а торговий
 * відкриває застосунок між справами.
 *
 * Мережевий сторож (watchdog.ts) лишається другим рубежем: він переживає
 * перезапуск процесу, але без мережі не прокидається взагалі.
 */

import { useEffect } from "react";
import { AppState } from "react-native";
import { IS_STAFF_BUILD } from "@/lib/flavor";
import { ensureFreshFixes } from "./health";
import { ensureRecording, isTracking } from "./controller";
import { isShiftOpen, getRole } from "./state";

/** Рідше, ніж поріг тиші, — щоб перевірка не била в ту саму мить, що й фікс. */
const CHECK_INTERVAL_MS = 2 * 60_000;

export function useTrackHealth(): void {
  useEffect(() => {
    if (!IS_STAFF_BUILD) return;

    const check = () => void ensureFreshFixes().catch(() => {});

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);

    /**
     * Повернення на екран — найцінніший момент перевірки: саме тоді людина
     * дивиться на застосунок, і саме тоді процес гарантовано живий після
     * можливого присипляння.
     *
     * І єдиний момент, коли запис можна ПІДНЯТИ. Android від 12-ї версії не
     * дає стартувати службу переднього плану з фону, тож сторож, який
     * прокидається щочверть години, у більшості випадків нічого вдіяти не
     * може. А з переднього плану старт дозволений завжди — і це та мить,
     * коли людина відкрила застосунок, часто саме тому, що їй прийшло
     * сповіщення «Трек зупинився».
     */
    const revive = async () => {
      const [shiftOpen, role, tracking] = await Promise.all([
        isShiftOpen(),
        getRole(),
        isTracking().catch(() => true),
      ]);
      if (!(shiftOpen || role === "DRIVER") || tracking) return;
      await ensureRecording().catch(() => {});
    };

    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      check();
      void revive();
    });

    // І одразу на монтуванні: холодний старт по натиску на сповіщення теж
    // мусить піднімати запис, а не лише перевіряти свіжість фіксів.
    void revive();

    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, []);
}
