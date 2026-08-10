/**
 * Заведення логіна й пароля наявним торговим.
 *
 * Навіщо: seed-sales-reps.ts створив торгових із технічним email
 * (rep-<slug>@budvik.local) і без пароля — увійти таким записом неможливо,
 * бо auth.ts відхиляє користувача з password = null. Цей скрипт замінює email
 * на справжній і ставить пароль, не чіпаючи id — тож усі прив'язані продажі,
 * плани й мотивація лишаються на місці.
 *
 * Дані читаються з окремого файлу, а не з аргументів: пароль в argv видно
 * в history і в списку процесів. Формат — по рядку на торгового:
 *
 *   Кавецький Віктор | viktor@example.com | пароль123
 *
 * Порожні рядки й ті, що починаються з #, ігноруються. Ім'я шукається тим
 * самим послівним зіставленням, що й у синхронізації, тому «Віктор» знайде
 * «Кавецький Віктор», але при двох кандидатах скрипт зупиниться, а не вгадає.
 *
 * Запуск:
 *   npx tsx scripts/set-rep-credentials.ts creds.txt           — перевірка
 *   npx tsx scripts/set-rep-credentials.ts creds.txt --apply   — застосувати
 */

import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "node:fs";

const prisma = new PrismaClient();

/** Той самий cost, що й у публічній реєстрації (api/register/route.ts). */
const BCRYPT_COST = 10;

/** Коротший пароль не варто заводити навіть тимчасово. */
const MIN_PASSWORD_LENGTH = 6;

interface CredLine {
  lineNo: number;
  name: string;
  email: string;
  password: string;
}

function parseCreds(path: string): CredLine[] {
  const raw = readFileSync(path, "utf8");
  const out: CredLine[] = [];

  raw.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length !== 3) {
      throw new Error(
        `Рядок ${lineNo}: очікую «Ім'я | email | пароль», а отримав ${parts.length} частин:\n  ${trimmed}`
      );
    }

    const [name, email, password] = parts;
    if (!name || !email || !password) {
      throw new Error(`Рядок ${lineNo}: є порожня частина:\n  ${trimmed}`);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`Рядок ${lineNo}: «${email}» не схоже на email`);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(
        `Рядок ${lineNo}: пароль для «${name}» коротший за ${MIN_PASSWORD_LENGTH} символів`
      );
    }

    out.push({ lineNo, name, email, password });
  });

  return out;
}

/**
 * Послівне зіставлення імен — копія логіки з sync-ingest/apply-documents.ts.
 * Тримаємо однаковою свідомо: якщо синхронізація вважає двох людей одним
 * торговим, скрипт має бачити те саме, інакше пароль ляже не на той запис.
 */
const wordsOf = (n: string) =>
  new Set(
    n
      .toLowerCase()
      .split(/[\s.]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
  );

interface Candidate {
  id: string;
  name: string;
  email: string;
  role: Role;
  password: string | null;
}

function findRep(query: string, users: Candidate[]): Candidate[] {
  // Точний email — найнадійніше, коли торгового вже перейменували.
  const byEmail = users.filter((u) => u.email.toLowerCase() === query.toLowerCase());
  if (byEmail.length > 0) return byEmail;

  const target = wordsOf(query);
  return users.filter((u) => {
    if (!u.name?.trim()) return false;
    const uw = wordsOf(u.name);
    return uw.size > 0 && [...uw].every((w) => target.has(w));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const path = args.find((a) => !a.startsWith("--"));

  if (!path) {
    console.error("Вкажіть файл із даними:\n  npx tsx scripts/set-rep-credentials.ts creds.txt");
    process.exit(1);
  }

  const creds = parseCreds(path);
  if (creds.length === 0) {
    console.error(`У файлі ${path} немає жодного рядка з даними.`);
    process.exit(1);
  }

  const users: Candidate[] = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, password: true },
  });

  const plan: Array<{ cred: CredLine; user: Candidate }> = [];
  const problems: string[] = [];

  for (const cred of creds) {
    const matches = findRep(cred.name, users);

    if (matches.length === 0) {
      problems.push(`Рядок ${cred.lineNo}: «${cred.name}» — такого користувача немає в базі`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(
        `Рядок ${cred.lineNo}: «${cred.name}» підходить одразу кільком — ` +
          `${matches.map((m) => `${m.name} <${m.email}>`).join("; ")}. ` +
          `Вкажіть email замість імені.`
      );
      continue;
    }

    const user = matches[0];

    // Email унікальний: якщо він уже зайнятий кимось іншим, update впаде на
    // P2002 посеред циклу. Ловимо це до запису, поки нічого не змінено.
    const emailOwner = users.find(
      (u) => u.email.toLowerCase() === cred.email.toLowerCase() && u.id !== user.id
    );
    if (emailOwner) {
      problems.push(
        `Рядок ${cred.lineNo}: email ${cred.email} уже належить іншому користувачу ` +
          `«${emailOwner.name}» (${emailOwner.role})`
      );
      continue;
    }

    if (user.role !== "SALES") {
      problems.push(
        `Рядок ${cred.lineNo}: «${user.name}» має роль ${user.role}, а не SALES. ` +
          `Змініть роль в адмінці або приберіть рядок.`
      );
      continue;
    }

    plan.push({ cred, user });
  }

  // Один і той самий торговий у двох рядках — останній мовчки перезаписав би
  // перший, і було б неясно, який пароль дійсно в базі.
  const seen = new Map<string, number>();
  for (const { cred, user } of plan) {
    const prev = seen.get(user.id);
    if (prev !== undefined) {
      problems.push(
        `Рядок ${cred.lineNo}: «${user.name}» уже згаданий у рядку ${prev} — залиште щось одне`
      );
    }
    seen.set(user.id, cred.lineNo);
  }

  console.log("── Що буде зроблено ──\n");
  for (const { cred, user } of plan) {
    const emailChange =
      user.email.toLowerCase() === cred.email.toLowerCase()
        ? "email без змін"
        : `email: ${user.email} → ${cred.email}`;
    const passChange = user.password ? "пароль: ПЕРЕЗАПИС наявного" : "пароль: задати вперше";
    console.log(`  ${user.name.padEnd(24)} ${emailChange}`);
    console.log(`  ${"".padEnd(24)} ${passChange}\n`);
  }

  if (problems.length > 0) {
    console.log("── Проблеми ──");
    for (const p of problems) console.log(`  ✗ ${p}`);
    console.log("");
  }

  if (problems.length > 0) {
    console.log("Нічого не змінено: спочатку виправте проблеми вище.");
    process.exit(1);
  }

  if (!apply) {
    console.log(`Це був перегляд (${plan.length} записів). Щоб застосувати, додайте --apply`);
    return;
  }

  for (const { cred, user } of plan) {
    const hashed = await bcrypt.hash(cred.password, BCRYPT_COST);
    await prisma.user.update({
      where: { id: user.id },
      data: { email: cred.email, password: hashed },
    });
    console.log(`  ✓ ${user.name.padEnd(24)} ${cred.email}`);
  }

  console.log(`\nГотово: ${plan.length}. Вхід на /login за email і паролем.`);
  console.log("Не забудьте видалити файл із паролями.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
