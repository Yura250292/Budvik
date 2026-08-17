"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

/**
 * Вкладений SessionProvider із уже прочитаною на сервері сесією.
 *
 * Кореневий провайдер (Providers.tsx) сесії не отримує — інакше кожна
 * публічна сторінка стала б динамічною через читання cookies. Тому на
 * повному завантаженні адмінки useSession() висів у "loading", доки не
 * повернеться GET /api/auth/session, і лише після цього стартували
 * запити даних — зайвий блокуючий RTT перед усім корисним.
 *
 * Адмінка й так динамічна (за middleware-авторизацією), тож тут сесію
 * можна читати на сервері безкоштовно: useSession() одразу
 * "authenticated", і дані їдуть з першого кадру.
 */
export default function AdminSessionProvider({
  session,
  children,
}: {
  session: Session | null;
  children: React.ReactNode;
}) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
