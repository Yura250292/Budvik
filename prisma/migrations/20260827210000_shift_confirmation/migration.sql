-- Звірка автоматично закритих змін наступного дня.
--
-- Автозакриття (воркер) і пізнє закриття лишають зміну без фінішного
-- фото: пробіг доїжджає зранку зі стартового одометра наступної. Ці три
-- поля відповідають на питання «а чи погодився з цим хтось живий».
ALTER TABLE "Shift" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "Shift" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "Shift" ADD COLUMN "confirmSource" TEXT;

-- Індекс потрібен обом сторонам: адмінка фільтрує «не підтверджені», а
-- застосунок питає про них на кожному відкритті екрана зміни.
CREATE INDEX "Shift_confirmedAt_idx" ON "Shift"("confirmedAt");
