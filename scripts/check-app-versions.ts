/**
 * Яка збірка застосунку стоїть у кожного — і кому оновлення стане поверх.
 *
 * 25.08.2026 змінився ключ підпису застосунку (старий, ефемерний,
 * утрачено разом із тим оточенням). Android не ставить збірку поверх
 * тієї, що підписана іншим ключем, — тому все, встановлене ДО 1.2,
 * оновити неможливо: застосунок доведеться поставити наново.
 *
 * Версію планшет називає сам, у User-Agent свого кабінету; сервер
 * запам'ятовує її в /api/app/version. Порожній список означає лише те,
 * що після останнього деплою ніхто ще не відкривав кабінет.
 *
 * Читання, жодних записів:
 *   npx tsx scripts/check-app-versions.ts
 */
import { prisma } from "../src/lib/prisma";
async function main(){
  const rows = await prisma.syncState.findMany({
    where: { key: { startsWith: "app:installed:" } },
    select: { key: true, value: true, updatedAt: true },
  });
  if (!rows.length) { console.log("Ще жоден планшет не відкривав кабінет після деплою."); }
  const ids = rows.map(r => r.key.replace("app:installed:", ""));
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map(u => [u.id, u.name]));
  for (const r of rows) {
    const v = r.value;
    const major = Number(v.split(".")[0]); const minor = Number(v.split(".")[1] ?? 0);
    const permanentKey = major > 1 || minor >= 2;   // 1.2 (25.08) — перша з постійним ключем
    console.log(`${(nameOf.get(r.key.replace("app:installed:","")) ?? "?").padEnd(20)} v${v.padEnd(5)} ${permanentKey ? "→ 1.5 стане ПОВЕРХ" : "→ потрібне перевстановлення"}   (сказав ${r.updatedAt.toISOString().slice(11,16)})`);
  }
  await prisma.$disconnect();
}
main();
