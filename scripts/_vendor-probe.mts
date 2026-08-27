/** Розвідка: чи придатний сайт виробника для автозбору фото (як sigma.ua). */
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const domains = process.argv.slice(2);

async function get(url: string, ms = 15000) {
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, "accept-language": "uk-UA,uk;q=0.9" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { status: r.status, url: r.url, text: r.status < 400 ? await r.text() : "" };
  } catch (e) { return { status: 0, url, text: "", err: (e as Error).message }; }
}

async function probe(host: string) {
  const base = host.startsWith("http") ? host : `https://${host}`;
  const root = await get(base);
  if (!root.status) return `${host.padEnd(32)} ✗ ${(root as any).err}`;
  const robots = await get(`${new URL(root.url).origin}/robots.txt`);
  const maps = [...robots.text.matchAll(/Sitemap:\s*(\S+)/gi)].map((m) => m[1]);
  const platform = /cdn\.shopify|Shopify/i.test(root.text) ? "shopify"
    : /wp-content|wp-json/i.test(root.text) ? "wordpress"
    : /horoshop/i.test(root.text) ? "horoshop"
    : /opencart|route=common/i.test(root.text) ? "opencart"
    : /bitrix/i.test(root.text) ? "bitrix" : "?";
  const ld = /application\/ld\+json/.test(root.text);
  return `${host.padEnd(32)} ${String(root.status).padEnd(4)} ${platform.padEnd(10)} ld+json:${ld ? "так" : "ні "} sitemap:${maps.length ? maps.join(" ") : "—"}  → ${root.url}`;
}

const out = await Promise.all(domains.map(probe));
for (const o of out) console.log(o);
