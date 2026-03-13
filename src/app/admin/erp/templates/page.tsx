"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";

const templateGroups = [
  {
    title: "Звіти",
    desc: "Шаблони для формування звітності",
    templates: [
      {
        name: "Звіт продажів",
        desc: "Шаблон для щомісячного звіту продажів",
        file: "/templates/report-sales.xlsx",
      },
      {
        name: "Звіт інвентаризації",
        desc: "Шаблон для проведення інвентаризації товарів",
        file: "/templates/report-inventory.xlsx",
      },
    ],
  },
  {
    title: "Рахунки",
    desc: "Шаблони фінансових документів",
    templates: [
      {
        name: "Видаткова накладна",
        desc: "Шаблон видаткової накладної для контрагентів",
        file: "/templates/invoice-template.xlsx",
      },
      {
        name: "Рахунок на оплату",
        desc: "Шаблон рахунку для виставлення оплати",
        file: "/templates/payment-request.xlsx",
      },
    ],
  },
  {
    title: "Зарплата",
    desc: "Шаблони для нарахувань",
    templates: [
      {
        name: "Нарахування ЗП",
        desc: "Шаблон для розрахунку заробітної плати",
        file: "/templates/salary-calculation.xlsx",
      },
    ],
  },
];

export default function TemplatesPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="text-g400 mt-2 text-sm">У вас немає доступу до цієї сторінки</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/admin"
          className="w-8 h-8 rounded-lg bg-g100 hover:bg-g200 flex items-center justify-center transition-colors"
        >
          <svg className="w-4 h-4 text-g600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </Link>
        <div>
          <h1 className="text-xl font-bold text-bk">Шаблони документів</h1>
          <p className="text-sm text-g400">Завантажте готові шаблони для звітів, рахунків та нарахувань</p>
        </div>
      </div>

      <div className="space-y-8">
        {templateGroups.map((group) => (
          <section key={group.title}>
            <div className="mb-3">
              <h2 className="text-[13px] font-semibold text-g400 uppercase tracking-wider">
                {group.title}
              </h2>
              <p className="text-xs text-g400 mt-0.5">{group.desc}</p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {group.templates.map((tpl) => (
                <div
                  key={tpl.file}
                  className="bg-white rounded-[var(--radius-card)] border border-g200 p-4 shadow-[0_1px_3px_rgba(0,0,0,0.04)] flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-green-50 flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-bk">{tpl.name}</h3>
                    <p className="text-xs text-g400 mt-0.5 mb-2">{tpl.desc}</p>
                    <a
                      href={tpl.file}
                      download
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      Завантажити .xlsx
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 p-4 bg-g100 rounded-xl">
        <p className="text-xs text-g400">
          Шаблони у форматі Excel (.xlsx). Завантажте, заповніть необхідні дані та збережіть.
        </p>
      </div>
    </div>
  );
}
