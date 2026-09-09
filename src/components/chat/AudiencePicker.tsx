"use client";

/**
 * Кому піде повідомлення.
 *
 * Галочки груп — лише офісу (рішення власника 09.09.2026). Торговий, водій
 * і складовщик пишуть у «Усі», у свою групу або особисто: у чужій групі їхнє
 * повідомлення побачили б, але відповісти туди вони не змогли б, і розмова
 * виглядала б як проігнорована.
 *
 * Групи й людина взаємовиключні: повідомлення «двом людям» — це вже група,
 * а не особисте, і зберігати його треба інакше.
 */

import { Check } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { GROUPS, ROLE_LABEL, isGroupRole, type GroupRole } from "@/lib/chat/audience";
import { COPY } from "./copy";
import type { Audience, Person } from "./api";

export const EMPTY_AUDIENCE: Audience = { toAll: false, toRoles: [], toUserId: null };

export function audienceChosen(a: Audience): boolean {
  return a.toAll || a.toRoles.length > 0 || Boolean(a.toUserId);
}

export function AudiencePicker({
  value,
  onChange,
  people,
  me,
  canPickGroups,
}: {
  value: Audience;
  onChange: (a: Audience) => void;
  people: Person[];
  me: { id: string; role: string };
  canPickGroups: boolean;
}) {
  /** Групи, у які цій людині взагалі можна писати. */
  const groups = canPickGroups ? GROUPS : GROUPS.filter((g) => g.role === null || g.role === me.role);
  const others = people.filter((p) => p.id !== me.id);

  const toggleGroup = (role: GroupRole | null) => {
    if (role === null) {
      onChange({ toAll: !value.toAll, toRoles: [], toUserId: null });
      return;
    }
    const has = value.toRoles.includes(role);
    const toRoles = has ? value.toRoles.filter((r) => r !== role) : [...value.toRoles, role];
    onChange({ toAll: false, toRoles, toUserId: null });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-cab-t2">{COPY.groups}</p>
        <div className="flex flex-wrap gap-2">
          {groups.map((g) => {
            const active = g.role === null ? value.toAll : isGroupRole(g.role) && value.toRoles.includes(g.role);
            return (
              <button
                key={g.key}
                type="button"
                onClick={() => toggleGroup(g.role)}
                aria-pressed={active}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
                  active ? "border-bk bg-bk text-white" : "border-cab-line bg-white text-cab-t2"
                }`}
              >
                {active && <Check size={14} />}
                {g.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-cab-t2">{COPY.people}</p>
        <div className="flex flex-col overflow-hidden rounded-2xl border border-cab-line bg-white">
          {others.map((p) => {
            const active = value.toUserId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onChange(active ? EMPTY_AUDIENCE : { toAll: false, toRoles: [], toUserId: p.id })}
                aria-pressed={active}
                className={`flex min-h-[52px] items-center gap-3 border-b border-[#F1F1EF] px-3.5 py-2 text-left last:border-0 ${
                  active ? "bg-cab-bg" : ""
                }`}
              >
                <Avatar name={p.name} id={p.id} src={p.avatarUrl} color={p.color} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-bk">{p.name}</span>
                  <span className="block text-[11px] text-cab-t3">{ROLE_LABEL[p.role] ?? p.role}</span>
                </span>
                {active && <Check size={18} className="shrink-0 text-bk" />}
              </button>
            );
          })}
          {others.length === 0 && <p className="px-3.5 py-4 text-sm text-cab-t3">Інших працівників немає</p>}
        </div>
      </div>
    </div>
  );
}
