"use client";

import { signIn, useSession, getSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { safeRelativePath } from "@/lib/utils";

/** Куди веде роль після входу. Порожня роль — звичайний покупець. */
function homeForRole(role: unknown): string {
  if (role === "MANAGER") return "/manager";
  if (role === "ADMIN") return "/admin";
  if (role === "SALES") return "/sales";
  if (role === "WAREHOUSE") return "/warehouse";
  if (role === "DRIVER") return "/driver";
  return "/dashboard";
}

function LoginForm() {
  const router = useRouter();
  const { data: session } = useSession();
  // Куди повертатись після входу: кошик надсилає сюди ?callbackUrl=/cart,
  // щоб покупець не шукав свій кошик знову після реєстрації
  const callbackUrl = safeRelativePath(useSearchParams().get("callbackUrl"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const goHome = useCallback(
    (role: unknown) => router.replace(callbackUrl ?? homeForRole(role)),
    [router, callbackUrl],
  );

  // Уже залогінений (зайшов на /login з живою кукою) — не тримаємо на формі.
  useEffect(() => {
    if (session) goHome((session.user as any)?.role);
  }, [session, goHome]);

  // Повертаємось на /login, а не одразу на /dashboard: розбір ролей вище
  // вже вміє відправити кожного куди треба. З хардкодом на /dashboard
  // торговий (як і склад, водій, менеджер) після Google-входу опинявся в
  // кабінеті покупця.
  const handleGoogle = () => {
    // callbackUrl проносимо крізь Google у query, а не як ціль редіректу:
    // повернення саме на /login лишає розбір ролей на місці
    const back = callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login";
    signIn("google", { callbackUrl: back });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    // Email чистимо тут, а не лише в authorize: з телефона перша літера
    // приїжджає великою (автокапіталізація) і збігу з базою немає.
    const res = await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: false,
    });

    if (res?.error) {
      setError("Невірний email або пароль");
      setLoading(false);
      return;
    }

    // Сесію питаємо явно, а не через router.refresh(): той перемальовує
    // серверні компоненти, але useSession лишається порожнім, ефект нижче
    // не спрацьовує — і людина стоїть на формі, ніби пароль не підійшов.
    const fresh = await getSession();
    if (!fresh) {
      setError("Не вдалося створити сесію. Спробуйте ще раз");
      setLoading(false);
      return;
    }
    goHome((fresh.user as any)?.role);
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-g50 py-12 px-4">
      <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8">
        <h1 className="text-2xl font-bold text-center text-bk mb-6">Вхід до БУДВІК27</h1>

        {error && (
          <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">{error}</div>
        )}

        <button
          onClick={handleGoogle}
          className="w-full flex items-center justify-center gap-3 border border-g300 rounded-lg px-3 py-2.5 font-medium text-g600 hover:bg-g50 transition mb-4"
        >
          <svg width="20" height="20" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Увійти через Google
        </button>

        <div className="relative mb-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-g300"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white px-2 text-g400">або</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-g600 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="your@email.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-g600 mb-1">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-g300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Введіть пароль"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-2.5 disabled:opacity-50"
          >
            {loading ? "Вхід..." : "Увійти"}
          </button>
        </form>

        <p className="text-center text-sm text-g500 mt-4">
          Немає акаунту?{" "}
          <Link
            href={callbackUrl ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/register"}
            className="text-primary-dark hover:underline font-medium"
          >
            Зареєструватися
          </Link>
        </p>
      </div>
    </div>
  );
}

// useSearchParams вимагає Suspense — без нього збірка Next падає
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
