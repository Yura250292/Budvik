/**
 * Очищення розмітки опису товару перед показом.
 *
 * Опис виводиться через `dangerouslySetInnerHTML`, а приходить він із трьох
 * різних місць: розбір каталогів постачальників, генерація моделлю і ручна
 * вставка. Тобто в базі лежить чужий HTML, який ніхто не переглядав.
 *
 * Що це вже коштувало: у 14 показних товарах в описі стоять `<img>` на сайти
 * постачальників — `bezeg.biz` (браузер блокує) і `element-shop.cz` (404).
 * На картці це порожня рамка й червоний рядок у консолі; жодне з тих фото не
 * завантажилось ні разу.
 *
 * Тут не повноцінний санітайзер (для цього потрібна бібліотека з розбором
 * дерева), а вузький фільтр під ці три джерела: прибрати те, що не має права
 * бути в описі товару, і не пускати чужі картинки. Небезпечних тегів у базі
 * зараз нема жодного — фільтр стоїть, щоб їх не занесло наступним розбором.
 */

/** Хости, з яких дозволено показувати картинки в описі. */
const ALLOWED_IMAGE_HOSTS = ["files.budvik27.com", "www.budvik27.com"];

/** Теги, які в описі товару не мають сенсу ні в якому вигляді. */
const DROP_BLOCKS = /<(script|style|iframe|object|embed|form|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const DROP_VOID = /<(link|meta|base|input|button)\b[^>]*>/gi;

/** Обробники подій: onerror=…, onclick=… — у будь-якому вигляді лапок. */
const EVENT_ATTRS = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

/** javascript:… у посиланнях. */
const JS_URLS = /\s(?:href|src)\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*'|javascript:[^\s>]+)/gi;

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

function imageAllowed(tag: string): boolean {
  const m = tag.match(SRC_ATTR);
  const src = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  if (!src) return false;
  // Відносний шлях — наш власний, лишаємо.
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  try {
    const host = new URL(src, "https://www.budvik27.com").hostname;
    return ALLOWED_IMAGE_HOSTS.includes(host);
  } catch {
    return false;
  }
}

/**
 * Прибирає з опису чужі картинки й теги, яким там не місце.
 *
 * Порожній рядок повертає як є — виклик безпечний для товарів без опису.
 */
export function sanitizeDescription(html: string): string {
  if (!html) return html;

  let out = html.replace(DROP_BLOCKS, "").replace(DROP_VOID, "");
  out = out.replace(IMG_TAG, (tag) => (imageAllowed(tag) ? tag : ""));
  out = out.replace(EVENT_ATTRS, "").replace(JS_URLS, "");

  // Після зняття картинок лишаються порожні обгортки — вони малюють пусті
  // рамки й відступи там, де вже нічого немає.
  out = out.replace(/<(p|div|span|figure)\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/\1\s*>/gi, "");

  return out.trim();
}
