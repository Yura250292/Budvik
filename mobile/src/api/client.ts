/**
 * Похід у /api/v1.
 *
 * Один модуль на всі запити: заголовок авторизації, розбір помилок і базова
 * адреса мусять жити в одному місці — інакше кожен новий екран додає свою
 * дрібну розбіжність, і 401 в одному місці розлогінює, а в іншому мовчить.
 */

import { getToken, clearToken } from "@/lib/auth-store";
import type { CardDto, CatalogPage, ProductDto, LookupResult, AppUser, AppConfig } from "./types";

/**
 * Куди ходити.
 *
 * У розробці телефон не бачить localhost машини — треба адреса в локальній
 * мережі (наприклад http://192.168.1.106:3111). Емулятор Android бачить її як
 * 10.0.2.2. Тому адреса береться зі змінної, а не зашита у збірку.
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ?? "https://www.budvik27.com";

/** Помилка з відповіді сервера — з текстом, який можна показати людині. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Запит без токена навіть якщо він є — для входу й реєстрації. */
  anonymous?: boolean;
};

async function request<T>(path: string, opts: Options = {}): Promise<T> {
  const token = opts.anonymous ? null : await getToken();

  const res = await fetch(`${API_BASE}/api/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && !opts.anonymous) {
    /**
     * Токен протух або його відкликали. Стираємо саме токен і нічого більше:
     * офлайн-кеш і обране лишаються на місці — людину розлогінило, вона не має
     * через це втратити свої списки.
     */
    await clearToken();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(
      body?.error ?? `Сервер відповів ${res.status}`,
      res.status
    );
  }

  return res.json() as Promise<T>;
}

export const api = {
  config: () => request<AppConfig>("/config"),

  catalog: (params: Record<string, string | number | undefined>) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") sp.set(k, String(v));
    }
    const qs = sp.toString();
    return request<CatalogPage>(`/catalog${qs ? `?${qs}` : ""}`);
  },

  product: (slug: string) => request<ProductDto>(`/products/${encodeURIComponent(slug)}`),

  lookup: (code: string) => request<LookupResult>(`/lookup?code=${encodeURIComponent(code)}`),

  login: (email: string, password: string, deviceName?: string) =>
    request<{ token: string; user: AppUser }>("/auth/login", {
      method: "POST",
      body: { email, password, deviceName },
      anonymous: true,
    }),

  register: (input: { email: string; password: string; name: string; phone?: string }) =>
    request<{ token: string; user: AppUser }>("/auth/register", {
      method: "POST",
      body: input,
      anonymous: true,
    }),

  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  me: () =>
    request<{
      user: AppUser & { phone: string | null; avatarUrl: string | null };
      bolts: {
        balance: number;
        transactions: {
          id: string;
          amount: number;
          type: string;
          description: string;
          createdAt: string;
        }[];
      };
    }>("/me"),

  deleteAccount: (password?: string) =>
    request<{ ok: true }>("/me", { method: "DELETE", body: { password } }),

  orders: () => request<{ orders: OrderSummary[] }>("/orders"),

  wishlist: () => request<{ items: CardDto[] }>("/wishlist"),

  wishlistAdd: (productId: string) =>
    request<{ ok: true }>("/wishlist", { method: "POST", body: { productId } }),

  wishlistRemove: (productId: string) =>
    request<{ ok: true }>(`/wishlist?productId=${encodeURIComponent(productId)}`, {
      method: "DELETE",
    }),

  pushRegister: (token: string, platform: "ios" | "android", appVersion?: string) =>
    request<{ ok: true }>("/push/register", {
      method: "POST",
      body: { token, platform, appVersion },
    }),

  pushUnregister: (token: string) =>
    request<{ ok: true }>("/push/unregister", { method: "POST", body: { token } }),

  createOrder: (input: {
    items: { productId: string; quantity: number }[];
    contactName: string;
    phone: string;
    city?: string;
    address?: string;
    deliveryMethod: "DELIVERY" | "PICKUP";
    comment?: string;
    useBolts?: boolean;
  }) =>
    request<{ id: string; orderNumber: number; guestToken: string | null }>("/orders", {
      method: "POST",
      body: input,
    }),
};

export type OrderSummary = {
  id: string;
  orderNumber: number;
  status: string;
  totalAmount: number;
  boltsUsed: number;
  boltsEarned: number;
  deliveryMethod: string;
  city: string | null;
  address: string | null;
  createdAt: string;
  items: {
    quantity: number;
    price: number;
    product: Pick<CardDto, "id" | "name" | "slug" | "image" | "packQty">;
  }[];
};
