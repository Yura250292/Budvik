# Помічник у кабінетах: моделі, блоки, файли

Коротка карта для того, хто правитиме помічника. Подробиці й причини рішень — у
коментарях файлів, на які тут посилання.

## Хто відповідає

| Вид | Де | Модель | Запасна |
| --- | --- | --- | --- |
| Керівник (ADMIN) | `/admin/assistant`, розмова «Уся фірма» | `ASSISTANT_ADMIN_MODEL`, типово `gemini-3.8-flash` | DeepSeek |
| Торговий, водій, склад | `/sales`, `/driver`, `/warehouse` | `ASSISTANT_MODEL`, типово `deepseek-flash` | немає |

- Спершу код: `router.ts` + `answers*.ts` відповідають на типові питання без моделі
  (0 токенів). Питання керівника з порадою, прогнозом, сезонністю, проханням файла
  або довші за 12 слів код не бере — `ADMIN_ANALYSIS`, `ADMIN_EXPORT` у `router.ts`.
- Дріт до моделі один на обох провайдерів: `src/lib/assistant/llm.ts`
  (OpenAI-сумісний формат; відмінності Gemini описані в шапці файла).
- Запасна модель і бюджет часу — `callModel` у `loop.ts`. Вичерпана квота
  пропускає модель на годину — `model-health.ts`.
- Перемикач «Gemini | DeepSeek» у тулбарі керівника шле провайдера, назву моделі
  бере сервер зі змінних середовища.
- Ключі: `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`. **Ключ Gemini станом на 16.09.2026 —
  безкоштовний тариф, 20 запитів на добу на модель**: після 5–10 ходів керівника
  відповідає DeepSeek. Щоб Gemini працювала весь день, у проєкті Google AI Studio
  треба ввімкнути білінг.

## Блоки у відповіді

Відповідь — звичайний маркдаун, а огороджені блоки з JSON кабінет малює
(`src/lib/assistant/blocks.ts` — формат і розбір, `AssistantMarkdown.tsx` — рендер):

| Блок | Що малює | Компонент |
| --- | --- | --- |
| `budvik-kpi` | 2–4 плитки з головними числами | `AssistantBlocks.tsx` |
| `budvik-chart` | column / bar / line / scatter, до 4 рядів, одна вісь, кнопка «Таблиця» | `AssistantChart.tsx` (Recharts, lazy) |
| `budvik-tree` | «що від чого залежить» деревом | `AssistantBlocks.tsx` |
| `budvik-file` | картка файла з кнопкою «Завантажити» | `FileCard.tsx` |
| `budvik-route` | точки маршруту з галочками | `RoutePicker.tsx` |

У історію для моделі блоки йдуть коротким описом, а не JSON (`blocksForHistory`).
Числа діаграм перевіряє числовий вартовий окремо й лише в журнал.

## Бренд

`facts/brands.ts` розв'язує бренд так, як його кажуть («Сила», «гроссер»,
«сігма»), і не вгадує: кілька збігів — варіанти. `team_overview(brand)` дає огляд
бренду (`facts/brand-overview.ts`), `stock_health(brand)` — його склад. Кодом:
«по фірмі СИЛА», «що по бренду APRO».

## Файли

Інструмент `export_file` (лише керівник): `xlsx`, `xlsx_1c` (лише заявка), `pdf`.
Набори: `order_proposal`, `dead_stock`, `receivables`, `abc`, `sql`, `rows` —
`src/lib/assistant/exports/datasets.ts`. Рядки рахує код, не модель.

- Файл лежить у R2 під `assistant/exports/<userId>/<uuid>`; віддає
  `GET /api/sales/assistant/files/[fileId]` лише тому, хто його сформував.
- **Треба руками один раз:** правило життєвого циклу R2 на префікс
  `assistant/exports/` — видаляти через 30 днів (панель Cloudflare → R2 → бакет →
  Settings → Object lifecycle rules).
- PDF: pdfmake 0.3 зі шрифтом Roboto із пакета; `next.config.ts` трасує шрифти в
  роут ходу помічника. Знака «₴» у Roboto немає — у PDF пишеться «грн».
- Файл для 1С — плоский Excel (код 1С, артикул, назва, кількість, ціна) для
  людини, яка створить документ у 1С. Сайт у 1С нічого не пише.

## Перевірка

```bash
npx tsx --env-file=.env scripts/assistant-route.mts        # що йде кодом, а що моделі
npx tsx --env-file=.env scripts/assistant-tables.mts       # таблиці й блоки кодових відповідей
npx tsx --env-file=.env scripts/assistant-preview.mts "по фірмі"
npx tsx --env-file=.env scripts/assistant-tool.mts export_file '{"format":"pdf","dataset":"order_proposal","brand":"APRO"}' ufedishin@gmail.com
npx tsx --env-file=.env scripts/assistant-turn.mts --model=deepseek "питання" ufedishin@gmail.com
npx tsx --env-file=.env scripts/probe-assistant-wire.mts gemini-3.6-flash   # дріт без бази
npx tsx --env-file=.env scripts/assistant-eval.mts --models=gemini,deepseek # порівняння моделей
```
