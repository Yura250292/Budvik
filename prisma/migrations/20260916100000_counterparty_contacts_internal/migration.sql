-- Контакти клієнтів із 1С, ознака «свій» і згода на повідомлення.
--
-- Навіщо. Сайт не має каналу до клієнта, а торгові працюють із вузьким
-- колом: 152 клієнти без покупок понад 90 днів дали 5,4 млн обороту 2026
-- року. Щоб писати їм, треба (1) живі телефони — досі лише одноразовий
-- імпорт у Counterparty.phone, нові клієнти приходять без номера; (2) не
-- писати своїм — ФОП торгових і склад очолюють список «втрачених»;
-- (3) знати, чи клієнт погодився на рекламні повідомлення — політика
-- приватності обіцяє без окремої згоди розсилок не надсилати.
--
-- Статуси рядками, а не enum — як у заявках і нарадах: новий стан не
-- вимагає ALTER TYPE, а старий клієнт Prisma не падає на невідомому значенні.
-- ADD COLUMN з константним DEFAULT у Postgres 11+ не переписує таблицю.
-- Стара версія сайту й воркера нових колонок і таблиці не помічає.

ALTER TABLE "Counterparty"
  ADD COLUMN "primaryPhoneE164" TEXT,
  ADD COLUMN "contactsSyncedAt" TIMESTAMP(3),
  ADD COLUMN "isInternal" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "internalReason" TEXT,
  ADD COLUMN "internalSetAt" TIMESTAMP(3),
  ADD COLUMN "internalSetById" TEXT,
  ADD COLUMN "marketingConsent" TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "marketingConsentAt" TIMESTAMP(3),
  ADD COLUMN "marketingConsentSource" TEXT,
  ADD COLUMN "marketingConsentById" TEXT,
  ADD COLUMN "marketingOptOutAt" TIMESTAMP(3),
  ADD COLUMN "preferredChannel" TEXT,
  ADD COLUMN "telegramChatId" TEXT,
  ADD COLUMN "telegramLinkCode" TEXT;

CREATE UNIQUE INDEX "Counterparty_telegramLinkCode_key" ON "Counterparty"("telegramLinkCode");

-- Рядки регістру 1С «КонтактнаяИнформация» (канал counterparty_contact) і
-- контакти, внесені на сайті. Обмін звіряє лише source = 'ONE_C'.
CREATE TABLE "CounterpartyContact" (
    "id" TEXT NOT NULL,
    "counterpartyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "kind1C" TEXT,
    "type1C" TEXT,
    "value" TEXT NOT NULL,
    "valueNormalized" TEXT,
    "personExternalId" TEXT,
    "personName" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SITE',
    "externalKey" TEXT,
    "ordinal" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CounterpartyContact_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CounterpartyContact_externalKey_key" ON "CounterpartyContact"("externalKey");
CREATE INDEX "CounterpartyContact_counterpartyId_idx" ON "CounterpartyContact"("counterpartyId");
-- Пошук клієнта за номером: майбутній бот («поділився контактом»), дублікати номерів.
CREATE INDEX "CounterpartyContact_valueNormalized_idx" ON "CounterpartyContact"("valueNormalized");

ALTER TABLE "CounterpartyContact" ADD CONSTRAINT "CounterpartyContact_counterpartyId_fkey"
  FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Сід ознаки «свій» тими самими маркерами, що й isInternalCounterparty
-- (src/lib/rep-feed/internal.ts). «ФОП <ім'я торгового>» назва не видає —
-- їх пропонує scripts/propose-internal-counterparties.mts, підтверджує людина.
--
-- Регістр — класами літер, а не lower(): у базі з локаллю C lower() кирилицю
-- не чіпає, і «Склад ( Дубляни)» мовчки лишився б клієнтом (так і було на
-- пробному прогоні). Класи працюють за будь-якої локалі.
UPDATE "Counterparty"
SET "isInternal" = true, "internalReason" = 'name-marker', "internalSetAt" = now()
WHERE "isInternal" = false
  AND (
    name ~ '^\s*[Сс][Пп][Іі][Вв][Рр][Оо][Бб][Іі][Тт][Нн][Ии][Кк][Ии]\s*$'
    OR name ~ '^\s*[Сс][Кк][Лл][Аа][Дд](\s|\()'
    OR name ~ '\(\s*([Сс]півробітник|[Тт]орговий|[Вв]одій|[Сс]клад|[Сс]истемний\s+[Аа]дмін|[Аа]дмін)\s*\)'
  );
