/**
 * Зіставлення товарів сайту з номенклатурою 1С (проставляння externalId).
 *
 * Навіщо це окремий крок. Синхронізація шукає товар за Product.externalId —
 * це GUID із 1С. Але в базі сайту 41 940 товарів і в жодного externalId не
 * заповнений: вони приїхали давнішими імпортами, які його не писали. Без
 * зіставлення перший же бойовий прогін не оновив би нічого, а створив би
 * 20 226 дублікатів поруч із наявними товарами.
 *
 * Ключ зіставлення — артикул. Він тут ідеальний: заповнений у всіх 41 940
 * товарів і унікальний. Назви для цього не годяться — вони розходяться між
 * системами на пробіли, лапки й скорочення.
 *
 * Скрипт НІЧОГО не видаляє і не змінює, крім externalId у товарів, які
 * впевнено зіставились. За замовчуванням лише показує, що зробив би:
 * запис вмикається прапорцем --apply.
 *
 * Запуск:
 *   npx tsx scripts/match-1c-products.ts --file out/product.ndjson
 *   npx tsx scripts/match-1c-products.ts --file out/product.ndjson --apply
 */

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type OneCProduct = {
  externalId: string;
  name: string;
  sku?: string;
};

/** Артикули в 1С і на сайті різняться регістром і пробілами, але не суттю. */
function normaliseSku(sku: string): string {
  return sku.trim().toLowerCase();
}

/**
 * Назва як запасний ключ зіставлення.
 *
 * Артикул сам по собі покриває лише чверть номенклатури: у 1С 4 808 товарів
 * узагалі без артикула, а на сайті 7 876 позицій мають технічний артикул
 * виду "1C-3D7853C0" від давнішого імпорту — там, де в 1С стоїть звичайний
 * номер. Назва в цій парі баз збігається вдвічі частіше.
 *
 * Нормалізація мінімальна й консервативна: регістр і зайві пробіли. Ми НЕ
 * прибираємо розділові знаки й одиниці виміру, бо "Ø18мм" і "Ø19мм" мають
 * лишатися різними товарами — надто агресивна нормалізація тут гірша за
 * пропущене зіставлення.
 */
function normaliseName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.indexOf("--file");
  const apply = args.includes("--apply");

  if (fileArg === -1 || !args[fileArg + 1]) {
    console.error("Вкажіть файл: --file <шлях до product.ndjson з агента>");
    process.exit(1);
  }

  const path = args[fileArg + 1];
  const lines = readFileSync(path, "utf8").split("\n").filter((l) => l.trim());

  const oneC: OneCProduct[] = lines.map((l) => JSON.parse(l));
  console.log(`Прочитано з 1С: ${oneC.length}`);

  // Артикул → товари 1С. Список, а не один запис: якщо артикул у 1С
  // повторюється, зіставляти по ньому не можна — незрозуміло, який із них.
  const oneCBySku = new Map<string, OneCProduct[]>();
  let without1cSku = 0;
  for (const p of oneC) {
    if (!p.sku?.trim()) {
      without1cSku++;
      continue;
    }
    const key = normaliseSku(p.sku);
    const list = oneCBySku.get(key);
    if (list) list.push(p);
    else oneCBySku.set(key, [p]);
  }
  const ambiguous1c = [...oneCBySku.values()].filter((v) => v.length > 1);
  console.log(`  без артикула в 1С: ${without1cSku}`);
  console.log(`  артикулів-дублікатів у 1С: ${ambiguous1c.length}`);

  const products = await prisma.product.findMany({
    select: { id: true, sku: true, name: true, externalId: true },
  });
  console.log(`Товарів на сайті: ${products.length}`);

  const siteBySku = new Map<string, typeof products>();
  for (const p of products) {
    if (!p.sku?.trim()) continue;
    const key = normaliseSku(p.sku);
    const list = siteBySku.get(key);
    if (list) list.push(p);
    else siteBySku.set(key, [p]);
  }

  const siteByName = new Map<string, typeof products>();
  for (const p of products) {
    if (!p.name?.trim()) continue;
    const key = normaliseName(p.name);
    const list = siteByName.get(key);
    if (list) list.push(p);
    else siteByName.set(key, [p]);
  }

  const toUpdate: Array<{
    id: string;
    externalId: string;
    sku: string;
    name: string;
    by: "sku" | "name";
  }> = [];
  let alreadyLinked = 0;
  let conflict = 0;
  let bySku = 0;
  let byName = 0;
  const unmatched1c: OneCProduct[] = [];

  // Один товар сайту не можна віддати двом записам 1С, тому зайняті id
  // відстежуються між обома проходами.
  const claimedSiteIds = new Set<string>();
  const claimedExternalIds = new Set<string>();

  /**
   * Спроба прив'язати один товар 1С до одного товару сайту.
   * Повертає true, якщо зіставлення відбулось або запис уже прив'язаний.
   */
  function tryLink(
    oneCProduct: OneCProduct,
    candidates: typeof products | undefined,
    by: "sku" | "name"
  ): boolean {
    // Неоднозначність з будь-якого боку — привід не чіпати: хибний зв'язок
    // гірший за його відсутність, бо потім ціни й залишки поїдуть не тому
    // товару, і помітити це буде важко.
    if (!candidates || candidates.length !== 1) return false;

    const site = candidates[0];
    if (claimedSiteIds.has(site.id)) return false;

    if (site.externalId === oneCProduct.externalId) {
      alreadyLinked++;
      claimedSiteIds.add(site.id);
      claimedExternalIds.add(oneCProduct.externalId);
      return true;
    }
    if (site.externalId) {
      // Уже прив'язаний до ІНШОГО запису 1С — справжній конфлікт даних,
      // мовчки перезаписувати його не можна.
      conflict++;
      return false;
    }
    if (claimedExternalIds.has(oneCProduct.externalId)) return false;

    claimedSiteIds.add(site.id);
    claimedExternalIds.add(oneCProduct.externalId);
    toUpdate.push({
      id: site.id,
      externalId: oneCProduct.externalId,
      sku: site.sku ?? "",
      name: site.name,
      by,
    });
    if (by === "sku") bySku++;
    else byName++;
    return true;
  }

  // Прохід 1: артикул + підтвердження назвою.
  //
  // Самого артикула НЕ досить. У цих двох базах знайшлось 171 місце, де
  // артикул той самий, а товар зовсім інший: у 1С "Розпилювач пшикалка",
  // на сайті під тим самим номером "Вила компостні". Прив'язавши їх, ми
  // відправили б ціну й залишок пшикалки на вила — і помітити це було б
  // майже неможливо, бо синхронізація звітувала б про успіх.
  //
  // Тому збіг за артикулом зараховується лише тоді, коли назва теж збігається.
  // Решта йде у ручний розбір, а не в мовчазну прив'язку.
  const pendingByName: OneCProduct[] = [];
  const skuNameConflicts: Array<{ sku: string; nameOneC: string; nameSite: string }> = [];

  for (const p of oneC) {
    const sku = p.sku?.trim();
    if (!sku) {
      pendingByName.push(p);
      continue;
    }
    const key = normaliseSku(sku);
    const oneCSame = oneCBySku.get(key);
    if (oneCSame && oneCSame.length > 1) {
      // Артикул неоднозначний у самій 1С — пробуємо за назвою.
      pendingByName.push(p);
      continue;
    }

    const candidates = siteBySku.get(key);
    if (candidates?.length === 1 && normaliseName(candidates[0].name) !== normaliseName(p.name)) {
      skuNameConflicts.push({
        sku,
        nameOneC: p.name,
        nameSite: candidates[0].name,
      });
      pendingByName.push(p);
      continue;
    }

    if (!tryLink(p, candidates, "sku")) pendingByName.push(p);
  }

  // Прохід 2: назва — для решти. Покриває товари без артикула в 1С і ті, що
  // на сайті лежать під технічним артикулом виду "1C-…".
  for (const p of pendingByName) {
    const key = normaliseName(p.name ?? "");
    if (!key) {
      unmatched1c.push(p);
      continue;
    }
    if (!tryLink(p, siteByName.get(key), "name")) unmatched1c.push(p);
  }

  console.log("");
  console.log("── Результат зіставлення ──");
  console.log(`  зіставлено вперше:      ${toUpdate.length}`);
  console.log(`     за артикулом:        ${bySku}`);
  console.log(`     за назвою:           ${byName}`);
  console.log(`  вже було прив'язано:    ${alreadyLinked}`);
  console.log(`  конфліктів (пропущено): ${conflict}`);
  console.log(`  артикул той самий, назва інша (пропущено): ${skuNameConflicts.length}`);
  console.log(`  є в 1С, немає на сайті: ${unmatched1c.length}`);
  console.log("");

  if (skuNameConflicts.length > 0) {
    console.log("УВАГА. Однаковий артикул, різні товари — прив'язку пропущено:");
    for (const c of skuNameConflicts.slice(0, 8)) {
      console.log(`  арт. ${c.sku}`);
      console.log(`     1С:   ${c.nameOneC.slice(0, 60)}`);
      console.log(`     сайт: ${c.nameSite.slice(0, 60)}`);
    }
    if (skuNameConflicts.length > 8) {
      console.log(`  ...і ще ${skuNameConflicts.length - 8}`);
    }
    console.log("");
  }

  if (toUpdate.length > 0) {
    console.log("Приклади зіставлень за артикулом:");
    for (const u of toUpdate.filter((x) => x.by === "sku").slice(0, 6)) {
      console.log(`  ${u.sku.padEnd(14)} ${u.name.slice(0, 50)}`);
    }
    console.log("");
    console.log("Приклади зіставлень за назвою:");
    for (const u of toUpdate.filter((x) => x.by === "name").slice(0, 6)) {
      console.log(`  ${u.sku.padEnd(14)} ${u.name.slice(0, 50)}`);
    }
    console.log("");
  }

  if (unmatched1c.length > 0) {
    console.log("Приклади товарів 1С без пари на сайті (їх створить синхронізація):");
    for (const p of unmatched1c.slice(0, 10)) {
      console.log(`  ${(p.sku ?? "").padEnd(14)} ${p.name.slice(0, 50)}`);
    }
    console.log("");
  }

  if (!apply) {
    console.log("Це був перегляд. Щоб записати, додайте --apply");
    return;
  }

  console.log("Записую externalId...");
  let done = 0;
  // Пачками: 41 тисяча окремих UPDATE через проксі-з'єднання тривала б довго.
  const chunkSize = 500;
  for (let i = 0; i < toUpdate.length; i += chunkSize) {
    const chunk = toUpdate.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((u) =>
        prisma.product.update({
          where: { id: u.id },
          data: { externalId: u.externalId, syncSource: "1C", syncedAt: new Date() },
        })
      )
    );
    done += chunk.length;
    process.stdout.write(`\r  ${done}/${toUpdate.length}`);
  }
  console.log("\nГотово.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
