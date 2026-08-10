import { Suspense } from "react";
import { UsersShell } from "./components/UsersShell";

/**
 * Розділ «Користувачі»: ролі, доступи, Telegram.
 *
 * Suspense обов'язковий — UsersShell читає useSearchParams() (вкладка в
 * ?tab=), і без межі Next вимагав би рендерити всю сторінку динамічно.
 */
export default function AdminUsersPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
        </div>
      }
    >
      <UsersShell />
    </Suspense>
  );
}
