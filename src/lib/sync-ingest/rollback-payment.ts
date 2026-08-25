/**
 * Відкат оплати, яку 1С більше не підтверджує.
 *
 * Потрібен двом сценаріям одразу: ордер розпровели (він зник із вивантаження)
 * і ордер відредагували (прийшла інша сума). В обох випадках правильна дія
 * однакова — прибрати наслідки старого запису, а далі або нічого, або
 * створити новий. Тому механізм один.
 *
 * Що саме відкочується: рознесення на торгового (йде каскадом за оплатою),
 * оплачена сума в рахунку і сам запис оплати. Рахунок, створений обміном під
 * цю ж оплату й не потрібний більше нікому, теж прибирається — інакше в ERP
 * накопичувались би порожні контейнери з нульовою сумою.
 *
 * Чому саме видалення, а не позначка «скасовано»: обмін ідемпотентний за
 * externalId, тож якщо документ у 1С проведуть назад, оплата приїде наступним
 * прогоном і відтвориться цілком. Позначка ж вимагала б окремого поля і
 * фільтра в кожному місці, яке рахує гроші, — а таких місць багато.
 */

import { prisma } from "@/lib/prisma";

/** Ознака рахунку, створеного самим обміном під оплату (див. ensureInvoice). */
const AUTO_INVOICE_PREFIX = "1C-";

/**
 * Прибирає оплату та її сліди. Повертає false, якщо оплати вже немає.
 *
 * Уся робота в одній транзакції: половинчастий відкат (алокації зняті, сума
 * в рахунку лишилась) був би гіршим за будь-який із двох станів.
 */
export async function rollbackPayment(paymentId: string): Promise<boolean> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true,
      amount: true,
      invoiceId: true,
      invoice: {
        select: {
          id: true,
          number: true,
          totalAmount: true,
          paidAmount: true,
          salesDocumentId: true,
          _count: { select: { payments: true } },
        },
      },
    },
  });
  if (!payment) return false;

  const invoice = payment.invoice;
  const remainingPaid = Math.max(0, invoice.paidAmount - payment.amount);

  // Рахунок-контейнер, створений обміном саме під цю оплату: більше платежів
  // у ньому немає, до документа продажу він не прив'язаний — отже без оплати
  // не означає нічого. Прив'язаний до накладної рахунок лишаємо завжди: він
  // існує сам по собі, незалежно від того, чи його оплатили.
  const invoiceIsOrphan =
    invoice._count.payments <= 1 &&
    !invoice.salesDocumentId &&
    invoice.number.startsWith(AUTO_INVOICE_PREFIX);

  await prisma.$transaction(async (tx) => {
    // Рознесення на торгових зникає каскадом за оплатою (onDelete: Cascade),
    // тому окремо його не чіпаємо.
    await tx.payment.delete({ where: { id: payment.id } });

    if (invoiceIsOrphan) {
      await tx.invoice.delete({ where: { id: invoice.id } });
      return;
    }

    await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: remainingPaid,
        paymentStatus:
          remainingPaid <= 0.01
            ? "UNPAID"
            : remainingPaid >= invoice.totalAmount - 0.01
              ? "PAID"
              : "PARTIAL",
      },
    });
  });

  return true;
}
