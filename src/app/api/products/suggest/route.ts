/**
 * Підказки пошуку для сайту.
 *
 * Уся драбина пошуку й уточнення живуть у lib/catalog/suggest — їх ділять цей
 * роут і /api/v1/suggest для застосунку. Тримати дві копії означало б, що на
 * однаковий запит вітрина й застосунок рано чи пізно почнуть показувати
 * різне, а пояснити це покупцеві нічим.
 */

import { NextResponse } from "next/server";
import { suggestAll } from "@/lib/catalog/suggest";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await suggestAll(searchParams.get("q") ?? ""));
}
