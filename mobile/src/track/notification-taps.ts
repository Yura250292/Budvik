/**
 * Куди вести людину, коли вона натиснула сповіщення.
 *
 * Без цього тап відкривав би просто застосунок — на тому екрані, де його
 * закрили. Нагадування «зміна ще відкрита» о дев'ятій вечора має вести на
 * екран зміни, інакше воно лише повідомляє про проблему, не даючи її
 * вирішити: людина мусить сама згадати, де ця кнопка.
 *
 * Обробників два, і потрібні обидва. Перший ловить натискання, поки застосунок
 * живий. Другий — коли його підняли САМЕ цим натисканням: у такому разі подія
 * сталася до того, як навігація змонтувалася, і слухач її вже не побачить.
 * Саме другий випадок і є типовим для вечірнього нагадування — телефон лежав
 * у кишені з вивантаженим застосунком.
 */

import { useEffect } from "react";
import * as Notifications from "expo-notifications";
import { useRootNavigationState, useRouter } from "expo-router";
import { IS_STAFF_BUILD } from "@/lib/flavor";

/**
 * Куди вести за вмістом сповіщення.
 *
 * Читаємо `screen` — назву маршруту, а не адресу зі схемою: сповіщення
 * обробляється всередині застосунку, тож схема тут зайва, зате помилитися нею
 * легко (у робочої збірки вона `budvik27staff://`, у магазинної `budvik27://`).
 *
 * Білий список, а не будь-який рядок: `data` приходить із сервера пушів теж, і
 * дозволяти йому кидати людину на довільний екран не варто.
 */
type Tap =
  | { pathname: "/shift" }
  | { pathname: "/cabinet"; params: { target: string } };

/** Сторінки кабінету, куди дозволено вести пушу. */
const CABINET_TARGET = /^\/(sales|driver)(\/[\w\-/]*)?$/;

function targetFor(response: Notifications.NotificationResponse | null): Tap | null {
  const data = response?.notification.request.content.data ?? {};
  const screen = data.screen;

  if (screen === "/shift") return { pathname: "/shift" };

  /**
   * Кабінет — це WebView, тож ведемо не на екран, а на сторінку сайту.
   * Адресу перевіряємо шаблоном: у `data` приходить те, що надіслав
   * сервер пушів, і пускати звідти довільний рядок у WebView не варто.
   */
  if (screen === "/cabinet") {
    const target = typeof data.target === "string" ? data.target : "";
    return CABINET_TARGET.test(target) ? { pathname: "/cabinet", params: { target } } : null;
  }

  return null;
}

export function useNotificationTaps(): void {
  const router = useRouter();
  /**
   * Навігація ще не змонтувалася — переходити нікуди.
   *
   * Саме той випадок, коли застосунок підняли натисканням: обробник спрацював
   * би раніше за навігатор, і перехід просто загубився б.
   */
  const navReady = !!useRootNavigationState()?.key;

  useEffect(() => {
    if (!IS_STAFF_BUILD || !navReady) return;

    let alive = true;

    /**
     * Застосунок підняли натисканням — подія вже сталася.
     *
     * getLastNotificationResponseAsync віддає її навіть тоді, коли слухача
     * ще не було. Без цієї гілки найчастіший сценарій (телефон у кишені,
     * процес вивантажений) не працював би взагалі.
     */
    Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (!alive) return;
        const target = targetFor(last);
        if (target) router.push(target);
      })
      .catch(() => {});

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const target = targetFor(response);
      if (target) router.push(target);
    });

    return () => {
      alive = false;
      sub.remove();
    };
  }, [router, navReady]);
}
