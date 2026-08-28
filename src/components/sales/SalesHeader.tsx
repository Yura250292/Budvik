"use client";

import SalesProfileMenu from "./SalesProfileMenu";
import { CabinetHeader } from "@/components/cabinet/Header";

/**
 * Шапка кабінету торгового = спільна шапка кабінету плюс меню профілю.
 *
 * Сама шапка живе в `@/components/cabinet/Header`: у водія вона така сама, і
 * дві копії розійшлися б на першій же правці відступу. Тут лишилося тільки
 * те, чого немає у водія, — аватарка з випадним меню.
 */
export function SalesHeader({
  title,
  subtitle,
  backTo,
  right,
  sticky = true,
  showProfile = true,
}: {
  title: string;
  /** Дрібний рядок над заголовком (роль, ім'я, кількість). */
  subtitle?: string;
  /** Куди веде «назад». Немає — кнопки немає (це головна секції). */
  backTo?: string;
  /** Слот під кнопки справа: дзвіночок, «Вийти», лічильник. */
  right?: React.ReactNode;
  sticky?: boolean;
  /** Сама сторінка профілю аватарку в шапці не дублює. */
  showProfile?: boolean;
}) {
  return (
    <CabinetHeader
      title={title}
      subtitle={subtitle}
      backTo={backTo}
      sticky={sticky}
      right={
        <>
          {right}
          {showProfile && <SalesProfileMenu />}
        </>
      }
    />
  );
}
