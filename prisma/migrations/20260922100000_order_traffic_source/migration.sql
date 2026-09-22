-- Звідки прийшов покупець: джерело візиту в події й у самому замовленні.
--
-- У події (SiteEvent.source) пишеться джерело ЦЬОГО візиту — лише на першій
-- події сесії, поряд із referrer. У замовленні — знімок із пам'яті браузера
-- (30 днів): покупець із Hotline часто повертається купувати за кілька днів,
-- і прив'язка до сесії загубила б саме ті замовлення, заради яких платимо
-- за клік.
--
-- enteredIn1CAt — позначка «менеджер вніс це замовлення в 1С». Ставить
-- людина кнопкою: у 1С ми не пишемо нічого і дізнатися самі не можемо.
--
-- Міграція лише додає колонки й індекси — стара версія сайту їх не помічає.

ALTER TABLE "Order"
    ADD COLUMN "source" TEXT,
    ADD COLUMN "sourceMedium" TEXT,
    ADD COLUMN "sourceCampaign" TEXT,
    ADD COLUMN "enteredIn1CAt" TIMESTAMP(3);

ALTER TABLE "SiteEvent" ADD COLUMN "source" TEXT;

CREATE INDEX "Order_source_createdAt_idx" ON "Order"("source", "createdAt");
CREATE INDEX "SiteEvent_source_createdAt_idx" ON "SiteEvent"("source", "createdAt");
