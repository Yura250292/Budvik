/**
 * Підказки пошуку для сайту.
 *
 * Уся драбина пошуку живе в lib/catalog/suggest — її ділять цей роут і
 * /api/v1/suggest для застосунку. Тримати дві копії означало б, що на
 * однаковий запит вітрина й застосунок рано чи пізно почнуть показувати
 * різне, а пояснити це покупцеві нічим.
 */

import { NextResponse } from "next/server";
import { suggestProducts } from "@/lib/catalog/suggest";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await suggestProducts(searchParams.get("q") ?? ""));
}
