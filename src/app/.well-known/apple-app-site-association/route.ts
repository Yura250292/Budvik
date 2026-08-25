/**
 * Universal Links для iOS: щоб посилання на товар відкривалося в застосунку,
 * а не в Safari.
 *
 * Роутом, а не файлом у public/, із двох причин. По-перше, Apple вимагає
 * Content-Type: application/json, а файл без розширення Next віддав би як
 * октет-стрім. По-друге, ідентифікатор команди приходить зі змінної
 * середовища: до реєстрації в Apple Developer його просто немає, і зашивати
 * заглушку у файл означало б колись забути її замінити.
 *
 * Apple не переходить за редіректами при перевірці цього файлу. Сайт
 * 308-редіректить голий домен на www, тож у застосунку мають бути
 * зареєстровані ОБИДВА домени — інакше половина посилань мовчки
 * відкриватиметься в браузері.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Формат: <TEAM_ID>.<bundle identifier>, наприклад ABCDE12345.ua.budvik.shop */
const APP_ID = process.env.IOS_APP_ID;

export async function GET() {
  /**
   * Немає ідентифікатора — 404, а не порожній файл.
   *
   * Порожній або неправильний association Apple кешує на своїх серверах, і
   * виправлення доїжджає до пристроїв не одразу. Краще, щоб файлу не було
   * зовсім, поки він не готовий.
   */
  if (!APP_ID) {
    return NextResponse.json({ error: "Not configured" }, { status: 404 });
  }

  return NextResponse.json(
    {
      applinks: {
        details: [
          {
            appIDs: [APP_ID],
            components: [
              { "/": "/catalog/*", comment: "картка товару" },
              { "/": "/brand/*", comment: "сторінка бренда" },
              { "/": "/order/*", comment: "трекінг гостьового замовлення" },
            ],
          },
        ],
      },
    },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
}
