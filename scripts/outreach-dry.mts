/**
 * # READ ONLY — сухий прогін пропозиції клієнту: факти, товари, усі варіанти тексту.
 *
 *   npx tsx --env-file=.env scripts/outreach-dry.mts --client <id> --rep <id> [--kind WIN_BACK] [--link]
 *   npx tsx --env-file=.env scripts/outreach-dry.mts --client <id> --rep <id> --db local
 *   npx tsx --env-file=.env scripts/outreach-dry.mts --rep <id> --timing [--db local]
 *
 * Нічого не пише: ні в ClientOutreach, ні в User.refCode (код торгового
 * читається як є, а якщо його ще немає — у посиланні стоїть заглушка).
 *
 * --db prod (за замовчуванням) — бойова база ДО міграції пропозицій: там немає
 *   таблиці ClientOutreach і нових полів контрагента (primaryPhoneE164,
 *   isInternal, marketingConsent…). Факти складаються тією самою
 *   buildOutreachFacts зі старих полів, історії пропозицій немає.
 * --db local — scratch-база з усіма міграціями (LOCAL_DB нижче або
 *   OUTREACH_LOCAL_DB): повний шлях composeOffer/listOutreachClients.
 * --timing — скільки триває список клієнтів торгового (/api/sales/clients).
 * --link — з посиланням на каталог. За замовчуванням без нього, як і на картці:
 *   на вітрині роздрібні ціни, вищі за опт у тексті.
 */

const LOCAL_DB = process.env.OUTREACH_LOCAL_DB ?? "postgresql://admin@127.0.0.1:5432/budvik_outreach_migcheck";

function args(name: string): string[] {
  const out: string[] = [];
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}` && argv[i + 1]) out.push(argv[++i]);
  return out;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const db = args("db")[0] ?? "prod";
// Підміна бази ДО імпорту Prisma: клієнт читає DATABASE_URL при створенні.
if (db === "local") process.env.DATABASE_URL = LOCAL_DB;

const { prisma } = await import("../src/lib/prisma");
const { clientStatesNow } = await import("../src/lib/assistant/facts/client-state");
const { agingByCounterparty } = await import("../src/lib/analytics/money-facts");
const { myClientsCte } = await import("../src/lib/assistant/facts/sql");
const { isInternalCounterparty, loadStaffNames } = await import("../src/lib/rep-feed/internal");
const { buildOutreachFacts, clientOutreachFacts, listOutreachClients } = await import("../src/lib/outreach/client-facts");
const { arrivalCandidates, pickOfferProducts } = await import("../src/lib/outreach/products");
const { availableKinds, composeOffer, defaultKind, offerWarnings } = await import("../src/lib/outreach/compose");
const { buildOfferLink, newLinkToken, outreachBaseUrl } = await import("../src/lib/outreach/links");
const { findInventedDiscount, kindShowsProducts, renderOffer, variantCount } = await import("../src/lib/outreach/templates");
const { isOutreachKind } = await import("../src/lib/outreach/types");

console.log(`# READ ONLY · база: ${db}`);

const repId = args("rep")[0];
if (!repId) {
  console.error("Потрібен --rep <id>");
  process.exit(2);
}
const rep = await prisma.user.findUnique({ where: { id: repId }, select: { name: true, refCode: true, role: true } });
if (!rep) {
  console.error(`Торгового ${repId} не знайдено`);
  process.exit(2);
}
const now = new Date();

if (flag("timing")) {
  const t0 = performance.now();
  if (db === "local") {
    const r = await listOutreachClients(repId, "all", now);
    console.log(`listOutreachClients: ${r.items.length} клієнтів, ${Math.round(performance.now() - t0)} мс`, r.counts);
  } else {
    // Той самий шлях, що listOutreachClients, без нових колонок і без ClientOutreach.
    const rows = await prisma.$queryRaw<Array<{ id: string; name: string }>>`
      WITH ${myClientsCte(repId)}
      SELECT c.id, c.name FROM "Counterparty" c
      WHERE c.id IN (SELECT id FROM my_clients) AND c.type IN ('CUSTOMER', 'BOTH')
    `;
    const t1 = performance.now();
    const staff = await loadStaffNames();
    const ids = rows.filter((r) => !isInternalCounterparty(r.name, staff)).map((r) => r.id);
    const t2 = performance.now();
    const [states] = await Promise.all([clientStatesNow(ids, now), agingByCounterparty(ids, now)]);
    const t3 = performance.now();
    const dormant = [...states.values()].filter((s) => s.state === "DORMANT" || s.state === "LOST").length;
    console.log(
      `клієнти: ${rows.length} (${Math.round(t1 - t0)} мс) · персонал: ${Math.round(t2 - t1)} мс · стани+борг: ${Math.round(
        t3 - t2
      )} мс · разом ${Math.round(t3 - t0)} мс · сплять/втрачені: ${dormant}`
    );
  }
}

const requestedKind = args("kind")[0];
if (requestedKind && !isOutreachKind(requestedKind)) {
  console.error(`Невідомий вид ${requestedKind}`);
  process.exit(2);
}

for (const clientId of args("client")) {
  console.log(`\n══════════ ${clientId} ══════════`);

  let facts;
  if (db === "local") {
    facts = await clientOutreachFacts(clientId, now);
  } else {
    const row = await prisma.counterparty.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, code: true, contactPerson: true, address: true, phone: true, receivableBalance: true },
    });
    if (row) {
      const [states, aging, staff] = await Promise.all([
        clientStatesNow([clientId], now),
        agingByCounterparty([clientId], now),
        loadStaffNames(),
      ]);
      facts = buildOutreachFacts({
        row,
        state: states.get(clientId),
        aging: aging.get(clientId),
        internal: isInternalCounterparty(row.name, staff),
        stats: undefined,
      });
    }
  }
  if (!facts) {
    console.log("клієнта не знайдено");
    continue;
  }

  const arrivals = await arrivalCandidates(clientId, now);
  const kinds = availableKinds(facts, { hasArrivals: arrivals.length > 0 });
  const kind = requestedKind && isOutreachKind(requestedKind) ? requestedKind : defaultKind(facts, kinds);

  console.log("факти:", {
    назва: facts.displayName,
    звертання: facts.greeting,
    телефон: facts.phone,
    стан: facts.state,
    днів: facts.daysSinceLast,
    ритм: facts.avgIntervalDays,
    борг: facts.receivable,
    прострочено: facts.overdue,
    внутрішній: facts.isInternal,
    остання_пропозиція: facts.lastOutreach,
  });
  console.log("види:", kinds.map((k) => `${k.key}${k.available ? "" : ` ✗ (${k.reason})`}`).join(", "));
  console.log(`вид: ${kind}${requestedKind ? "" : " (за замовчуванням)"} · прихід за тиждень: ${arrivals.length}`);

  if (db === "local") {
    const offer = await composeOffer(clientId, repId, kind, {
      now,
      context: { facts, arrivals },
      refCode: rep.refCode ?? null,
      withLink: flag("link"),
    });
    console.log("composeOffer:", offer);
    continue;
  }

  const t0 = performance.now();
  const products = kindShowsProducts(kind) ? await pickOfferProducts(clientId, repId, kind, now, { arrivals }) : [];
  console.log(`товари (${Math.round(performance.now() - t0)} мс):`);
  for (const p of products) {
    console.log(
      `  • ${p.name} | арт. ${p.sku ?? "—"} | опт ${p.wholesalePrice ?? "—"} | вільно ${p.freeStock} | ${
        p.boughtBefore ? "брав" : "не брав"
      } | ${p.why}`
    );
  }
  console.log("попередження:", offerWarnings(facts, kind));

  const base = outreachBaseUrl() || "https://www.budvik27.com";
  const refCode = rep.refCode ?? "XXXXXXXX";
  const token = newLinkToken();
  const link = flag("link") ? buildOfferLink({ base, refCode, slug: products[0]?.slug, token }) : null;
  const shortLink = flag("link") ? buildOfferLink({ base, refCode, token }) : null;

  for (let v = 0; v < variantCount(kind); v++) {
    const r = renderOffer(kind, v, {
      counterpartyId: clientId,
      greetingName: facts.greetingName,
      repName: rep.name,
      products,
      link,
      shortLink,
      debtAmount: facts.receivable,
    });
    const word = findInventedDiscount(r.text, kind);
    console.log(
      `\n--- варіант ${v + 1}/${r.variants} · ${r.chars} знаків · товарів ${r.productCount}${r.steps.length ? ` · вміщення: ${r.steps.join(", ")}` : ""}${word ? ` · ✗ «${word}»` : ""}`
    );
    console.log(r.text);
  }
}

await prisma.$disconnect();
console.log("\nNothing was written.");
