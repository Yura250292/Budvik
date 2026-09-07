import { Suspense } from "react";
import AssistantEntry from "@/components/sales/assistant/AssistantEntry";

export const metadata = { title: "Помічник" };
/** Розмова завжди свіжа: список діалогів і потік відповіді кешувати нічим. */
export const dynamic = "force-dynamic";

/**
 * Помічник керівника всередині шелла адмінки.
 *
 * Сторінка тонка навмисно: що саме вміє помічник, вирішує РОЛЬ на сервері
 * (див. kindForThread), а не адреса. Тут лише секція — від неї залежить
 * розкладка (екран вбудований у шелл, а не поверх нього) і те, куди
 * повертає «назад» із картки клієнта.
 */
export default function AdminAssistantPage() {
  return (
    <Suspense fallback={<div className="p-4 text-sm text-g500">Завантаження…</div>}>
      <AssistantEntry section="admin" />
    </Suspense>
  );
}
