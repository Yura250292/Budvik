"use client";

/**
 * Зміна ролі користувача одним селектом.
 *
 * Раніше це були ad-hoc кнопки («Менеджер», «Торговий», «Зняти роль»), різні
 * на кожній сторінці: у списку не було WAREHOUSE, у картці — DRIVER. Тепер
 * перелік один (lib/roles.ts), а гарди дзеркалять серверні перевірки в
 * api/admin/users/[id]/route.ts — UI лише прибирає можливість помилки,
 * рішення все одно ухвалює сервер.
 */

import { useState } from "react";
import type { Role } from "@prisma/client";
import {
  ASSIGNABLE_ROLES,
  ROLE_DEMOTION_WARNING,
  canAssignRole,
  roleColor,
  roleLabel,
} from "@/lib/roles";

export function RoleSelect({
  userId,
  userName,
  role,
  actorRole,
  actorId,
  disabled,
  onChanged,
}: {
  userId: string;
  userName: string;
  role: string;
  actorRole: string;
  actorId: string;
  disabled?: boolean;
  onChanged: (next: Role) => void;
}) {
  const [busy, setBusy] = useState(false);

  const isSelf = userId === actorId;

  // Адміна не понижують через список — і показувати йому селект, який завжди
  // повертає 403, чесніше просто бейджем.
  if (role === "ADMIN") {
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${roleColor(role)}`}>
        {roleLabel(role)}
      </span>
    );
  }

  const options = ASSIGNABLE_ROLES.filter(
    (r) => r === role || canAssignRole(actorRole, role, r)
  );

  const change = async (next: Role) => {
    if (next === role) return;

    const warning = ROLE_DEMOTION_WARNING[role as Role];
    const question =
      `Змінити роль: ${userName} → ${roleLabel(next)}?` +
      (warning ? `\n\n${warning}` : "");
    if (!confirm(question)) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Не вдалося змінити роль");
        return;
      }
      onChanged(next);
    } finally {
      setBusy(false);
    }
  };

  return (
    <select
      value={role}
      disabled={busy || disabled || isSelf}
      onChange={(e) => change(e.target.value as Role)}
      // Свою роль не міняють: сервер віддає 400, але без disabled це була б
      // мовчазна помилка «клікнув — нічого не сталося».
      title={isSelf ? "Власну роль змінити не можна" : undefined}
      aria-label={`Роль: ${userName}`}
      className="cursor-pointer rounded-[var(--radius-btn)] border border-g300 bg-white px-2.5 py-1.5 text-xs font-medium text-bk transition-colors hover:border-g400 disabled:cursor-not-allowed disabled:bg-g100 disabled:text-g400"
    >
      {options.map((r) => (
        <option key={r} value={r}>
          {roleLabel(r)}
        </option>
      ))}
    </select>
  );
}
