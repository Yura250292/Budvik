/**
 * Оплата і доставка.
 *
 * У футері цей пункт стояв сірим написом без посилання — разом із «Гарантією»
 * і «Договором оферти». Саме ці три сторінки покупець шукає перед тим, як
 * натиснути «Оформити замовлення», і не знаходив нічого.
 *
 * Тут лише те, що магазин справді робить (умови взято з блоку «Купівля» на
 * картці товару й зі сторінки оформлення): оплата при отриманні, доставка за
 * адресою, самовивіз зі складу у Львові. Тарифів перевізників і строків не
 * вигадуємо — за ними відправляємо до менеджера.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { SITE_CONTACTS } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: "Оплата і доставка",
  description:
    "Як оплатити й отримати замовлення в БУДВІК27: оплата при отриманні готівкою або карткою, доставка за адресою по Україні, самовивіз зі складу у Львові.",
  alternates: { canonical: "/dostavka-i-oplata" },
};

const PAYMENT = [
  {
    title: "Оплата при отриманні",
    text: "Готівкою або карткою, коли товар уже у вас. Передоплата не потрібна.",
  },
  {
    title: "Безготівковий розрахунок",
    text: "Для підприємців і компаній виставляємо рахунок. Скажіть менеджеру, і надішлемо реквізити.",
  },
];

const DELIVERY = [
  {
    title: "Доставка за адресою",
    text: "Привеземо замовлення на вашу адресу. Вартість і день доставки менеджер підтвердить у дзвінку — вони залежать від міста, ваги й габаритів.",
  },
  {
    title: "Самовивіз зі складу",
    text: `Заберете самі: ${SITE_CONTACTS.city}, ${SITE_CONTACTS.street}. Перед виїздом зателефонуйте — підкажемо, як заїхати, і зберемо замовлення.`,
  },
];

export default function DeliveryAndPaymentPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:py-12">
      <nav className="mb-5 text-sm text-[#9E9E9E]">
        <Link href="/" className="hover:text-[#FFB800]">
          Головна
        </Link>
        <span className="text-[#DADADA]">{" / "}</span>
        <span className="text-[#0A0A0A]">Оплата і доставка</span>
      </nav>

      <h1 className="text-2xl font-bold leading-tight text-[#0A0A0A] sm:text-3xl">Оплата і доставка</h1>
      <p className="mt-3 text-[#6B6B6B]">
        Замовлення можна оформити на сайті або телефоном. Оплата — при отриманні, тож
        нічого переказувати наперед не треба.
      </p>

      <section className="mt-9">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#9E9E9E]">Оплата</h2>
        <dl className="mt-3 divide-y divide-[#EFEFEF] rounded-xl border border-[#EFEFEF] bg-white">
          {PAYMENT.map((p) => (
            <div key={p.title} className="p-4">
              <dt className="font-semibold text-[#0A0A0A]">{p.title}</dt>
              <dd className="mt-1 text-sm text-[#6B6B6B]">{p.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[#9E9E9E]">Доставка</h2>
        <dl className="mt-3 divide-y divide-[#EFEFEF] rounded-xl border border-[#EFEFEF] bg-white">
          {DELIVERY.map((d) => (
            <div key={d.title} className="p-4">
              <dt className="font-semibold text-[#0A0A0A]">{d.title}</dt>
              <dd className="mt-1 text-sm text-[#6B6B6B]">{d.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8 rounded-xl bg-[#FFFDF0] p-5">
        <h2 className="font-semibold text-[#0A0A0A]">Питання по конкретному замовленню</h2>
        <p className="mt-2 text-sm text-[#6B6B6B]">
          Вартість доставки у ваше місто, наявність великої партії, підбір аналога —
          швидше вирішити голосом.
        </p>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold text-[#0A0A0A]">
          <a href={`tel:${SITE_CONTACTS.phone}`} className="underline decoration-[#FFD600] decoration-2 underline-offset-2">
            {SITE_CONTACTS.phoneDisplay}
          </a>
          <a href={`tel:${SITE_CONTACTS.phoneAlt}`} className="underline decoration-[#FFD600] decoration-2 underline-offset-2">
            {SITE_CONTACTS.phoneAltDisplay}
          </a>
          <a href={`mailto:${SITE_CONTACTS.email}`} className="underline decoration-[#FFD600] decoration-2 underline-offset-2">
            {SITE_CONTACTS.email}
          </a>
        </div>
      </section>

      <p className="mt-8 text-sm text-[#6B6B6B]">
        Якщо товар не підійшов або виявився з недоліком — умови обміну, повернення й
        гарантійного випадку описані на сторінці{" "}
        <Link href="/povernennya" className="font-medium text-[#0A0A0A] underline decoration-[#FFD600] decoration-2 underline-offset-2">
          «Обмін та повернення»
        </Link>
        .
      </p>
    </div>
  );
}
