/**
 * Спільне для сторінок автопарку: типи відповідей API, поля форм, запити.
 */

import type { ReactNode } from "react";
import type { StatusKey } from "@/lib/analytics/colors";
import type { DueState } from "@/lib/fleet/due";
import type { FleetOverview, FleetRuleDue, FleetVehicle } from "@/lib/fleet/overview";
import { num } from "@/components/ui/Stat";

export type { FleetOverview, FleetRuleDue, FleetVehicle };
export type Person = { id: string; name: string; role: string };
export type ListResponse = FleetOverview & { people: Person[] };

export type ServiceRow = {
  id: string;
  day: string;
  odometerKm: number | null;
  kind: string;
  kindLabel: string;
  title: string;
  partsCost: number;
  laborCost: number;
  total: number;
  vendor: string | null;
  notes: string | null;
  hasReceipt: boolean;
  createdBy: string | null;
};

export type DetailResponse = {
  vehicle: FleetVehicle;
  services: ServiceRow[];
  assignments: Array<{ id: string; userId: string; name: string; from: string; to: string | null }>;
};

export const INPUT =
  "w-full rounded-[var(--radius-badge)] border border-g200 bg-white px-2.5 py-1.5 text-sm text-bk focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary-dark";
export const BTN_PRIMARY =
  "cursor-pointer rounded-[var(--radius-btn)] bg-primary px-3.5 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover disabled:opacity-60";
export const BTN_GHOST =
  "cursor-pointer rounded-[var(--radius-badge)] border border-g200 px-2.5 py-1.5 text-xs text-g600 transition-colors hover:border-g300 hover:text-bk disabled:opacity-60";

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-g600">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[11px] text-g400">{hint}</span>}
    </label>
  );
}

export const DUE_STATUS: Record<DueState, StatusKey> = {
  overdue: "bad",
  soon: "warn",
  unknown: "neutral",
  ok: "good",
};

/** «через 1 200 км» / «на 300 км пізніше» — людською мовою, що саме лишилось. */
export function dueText(d: FleetRuleDue): string {
  const parts: string[] = [];
  if (d.kmLeft != null) {
    parts.push(d.kmLeft > 0 ? `через ${num(d.kmLeft)} км` : `перебіг ${num(-d.kmLeft)} км`);
  }
  if (d.daysLeft != null) {
    parts.push(d.daysLeft > 0 ? `до ${ddmmyyyy(d.dueDay!)}` : `з ${ddmmyyyy(d.dueDay!)}`);
  }
  if (d.state === "unknown") return "немає запису про заміну";
  return parts.join(" або ");
}

export function ddmmyyyy(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

export function todayKyiv(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(new Date());
}

/** JSON-запит із помилкою сервера як текстом. */
export async function send(url: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
  return json ?? {};
}

/**
 * Фото чека стискаємо в браузері до ~2000 px JPEG: фото з телефона важить
 * 4–8 МБ, а тіло запиту до функції Vercel обмежене 4,5 МБ. PDF і HEIC
 * (браузер його не розкодує) ідуть як є.
 */
export async function shrinkReceipt(file: File): Promise<Blob> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}
