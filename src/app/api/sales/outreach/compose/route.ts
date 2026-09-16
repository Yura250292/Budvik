import { NextResponse } from "next/server";
import { CABINET_ROLES, requireRoles } from "@/lib/app/identity";
import {
  availableKinds,
  composeOffer,
  normalizePromoText,
  prepareCompose,
  resolveKind,
} from "@/lib/outreach/compose";
import { OfferTextError } from "@/lib/outreach/templates";

/**
 * Скласти пропозицію клієнту — нічого не зберігаючи.
 *
 * Ролі ті самі, що в картці клієнта: торгові універсальні й відкривають
 * будь-кого з бази, тож і написати можуть будь-кому. Відповідь не кешується:
 * у ній свіжий токен посилання, і два торгові не мають отримати один.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await requireRoles(req, CABINET_ROLES);
  if (!auth.ok) return auth.response;

  const sp = new URL(req.url).searchParams;
  const counterpartyId = sp.get("counterpartyId")?.trim();
  if (!counterpartyId) return NextResponse.json({ error: "Не вказано клієнта" }, { status: 400 });

  const promoText = normalizePromoText(sp.get("promoText"));
  const variantRaw = sp.get("variant");
  const variant = variantRaw !== null && variantRaw !== "" ? Number(variantRaw) : undefined;
  // link=1 — посилання на каталог. Без нього текст без посилання: на вітрині
  // роздрібні ціни, а в тексті — опт (див. composeOffer).
  const withLink = sp.get("link") === "1";

  const now = new Date();
  const context = await prepareCompose(counterpartyId, now);
  if (!context) return NextResponse.json({ error: "Клієнта не знайдено" }, { status: 404 });

  const kinds = availableKinds(context.facts, { hasArrivals: context.arrivals.length > 0, promoText });
  const kind = resolveKind(sp.get("kind"), context.facts, kinds);

  try {
    const offer = await composeOffer(counterpartyId, auth.me.userId, kind, {
      variant: variant != null && Number.isFinite(variant) ? variant : undefined,
      now,
      promoText,
      context,
      withLink,
    });
    const f = context.facts;
    return NextResponse.json(
      {
        offer,
        kinds,
        client: {
          id: f.id,
          name: f.name,
          displayName: f.displayName,
          marketingConsent: f.marketingConsent,
          marketingConsentAt: f.marketingConsentAt,
          marketingOptOutAt: f.marketingOptOutAt,
          preferredChannel: f.preferredChannel,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    // Шаблон спробував пообіцяти знижку — це помилка в шаблоні, а не в
    // запиті, але торговому треба сказати людською мовою, а не 500.
    if (e instanceof OfferTextError) return NextResponse.json({ error: e.message }, { status: 422 });
    throw e;
  }
}
