"use client";

import { useEffect, useState } from "react";
import { getSession, useSession } from "next-auth/react";
import type { Session } from "next-auth";

/**
 * Сесія для роль-гейтів кабінетів — з перепиткою замість миттєвого «вас вигнало».
 *
 * Навіщо. next-auth читає /api/auth/session так: спершу res.json(), і лише
 * потім дивиться на res.ok (node_modules/next-auth/client/_utils.js). Тож
 * будь-яка відповідь не-JSON — 429 від захисту Vercel, 503 від переповненої
 * функції, обрив мережі — це виняток, який ловиться і мовчки перетворюється
 * на null. Для useSession це не помилка, а «сесії немає»: status стає
 * "unauthenticated", і гейт показує «Потрібен вхід» людині, у якої кука на
 * місці й нікуди не поділась.
 *
 * Саме це й ловили в каталозі торгового: зміст каталогу — це ~250 посилань
 * у динамічний /sales/catalog/list, Next тягне їх префетчем при появі в
 * екрані, і запит сесії тонув у цьому залпі. Залп прибрано в самому
 * каталозі (prefetch={false}), але причина була ширша за одну сторінку:
 * будь-який поганий інтернет у машині дає той самий фальшивий вихід.
 *
 * Чому перепитуємо самі. Повторної спроби next-auth не робить: update()
 * першим рядком виходить, якщо сесії немає, а провайдер перечитує її лише
 * на фокус вікна — тобто екран «Потрібен вхід» висить, поки людина не
 * перемкнеться в інше вікно й назад.
 *
 * Чому це не діра. У /sales і /driver без токена не пускає middleware
 * (src/middleware.ts), тож "unauthenticated" на цих шляхах майже завжди
 * означає «не змогли спитати», а не «не увійшов». Якщо сесії справді немає
 * — спроби вичерпаються і гейт покаже вхід, лише на секунду пізніше.
 */

/** Паузи перед повторними спробами. Двох вистачає: залп префетчів осідає швидше. */
const RETRY_MS = [700, 2000];

export type GateStatus = "loading" | "authenticated" | "unauthenticated";

export function useGateSession(): { session: Session | null; status: GateStatus } {
  const { data, status } = useSession();
  /** Сесія, яку дістали власним запитом, коли провайдер уже здався. */
  const [rescued, setRescued] = useState<Session | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (status !== "unauthenticated" || rescued) return;
    if (attempt >= RETRY_MS.length) return;

    let alive = true;
    const timer = setTimeout(() => {
      /*
        broadcast: false — обовʼязково.

        Типово getSession розсилає подію іншим вкладкам, а SessionProvider
        на неї перечитує сесію запитом. Тобто наша спроба врятувати кабінет
        у одній вкладці змушувала б адмінку в сусідній піти по той самий
        /api/auth/session — той, що зараз падає, — і вибити з сесії вже її.
        Ми рятуємо свій гейт, а не сповіщаємо світ.
      */
      getSession({ broadcast: false })
        .then((s) => {
          if (alive && s?.user) setRescued(s);
        })
        .catch(() => {
          // getSession сам ковтає помилки і віддає null — цей catch на випадок
          // зміни поведінки в next-auth, щоб лічильник спроб не завис.
        })
        .finally(() => {
          if (alive) setAttempt((n) => n + 1);
        });
    }, RETRY_MS[attempt]);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [status, attempt, rescued]);

  const session = data ?? rescued;
  if (session) return { session, status: "authenticated" };
  // Поки спроби не вичерпані — це ще не «не увійшов», а «не дізнались».
  if (status === "loading" || attempt < RETRY_MS.length) return { session: null, status: "loading" };
  return { session: null, status: "unauthenticated" };
}
