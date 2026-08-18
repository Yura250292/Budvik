/**
 * Структуровані дані schema.org у <script type="application/ld+json">.
 *
 * Екрануємо «<», щоб текст з опису 1С (там трапляється сирий HTML) не міг
 * закрити тег скрипта і вилити решту JSON у розмітку сторінки.
 */
export default function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
