/**
 * App Links для Android: щоб посилання на товар відкривалося в застосунку.
 *
 * Відбиток підпису приходить зі змінної середовища: у релізної збірки він
 * свій, і в Play Console з підписом від Google — ще один. Обидва треба
 * перелічити, інакше посилання працюватимуть у тестовій збірці й перестануть
 * у тій, що з магазину.
 *
 * Формат ANDROID_SHA256_FINGERPRINTS — відбитки через кому:
 *   AB:CD:...:12,34:56:...:78
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PACKAGE = "ua.budvik.shop";

const FINGERPRINTS = (process.env.ANDROID_SHA256_FINGERPRINTS ?? "")
  .split(",")
  .map((f) => f.trim())
  .filter(Boolean);

export async function GET() {
  if (FINGERPRINTS.length === 0) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  return NextResponse.json(
    [
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: PACKAGE,
          sha256_cert_fingerprints: FINGERPRINTS,
        },
      },
    ],
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
