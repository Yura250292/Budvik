/**
 * Запис `User.notificationPrefs` злиттям.
 *
 * В одному JSON живуть перемикачі торгового (mutedTypes, othersDocs) і поля
 * керівника (adminTypes, feedSeenAt). Заміна цілим об'єктом стирала б
 * чуже: «переглянув стрічку» затирав би вибір пушів і навпаки. Тому лише
 * `||` у самій базі — одним оператором, без читання перед записом.
 *
 * Без next/*: імпортує і воркер.
 */

import { prisma } from "@/lib/prisma";

export async function savePrefs(userId: string, patch: Record<string, unknown>): Promise<unknown> {
  const rows = await prisma.$queryRaw<{ notificationPrefs: unknown }[]>`
    UPDATE "User"
    SET "notificationPrefs" =
      (CASE WHEN jsonb_typeof("notificationPrefs") = 'object' THEN "notificationPrefs" ELSE '{}'::jsonb END)
      || ${JSON.stringify(patch)}::jsonb
    WHERE id = ${userId}
    RETURNING "notificationPrefs"`;
  return rows[0]?.notificationPrefs ?? null;
}
