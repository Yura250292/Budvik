/**
 * Розбір потоку подій від сервера.
 *
 * Свій парсер, а не EventSource: той уміє лише GET, а питання йде тілом
 * POST. Формат простий — блоки, розділені порожнім рядком, у кожному
 * рядки `event:` і `data:`.
 *
 * Резервний шлях на випадок, коли потоку немає (старий WebView, проксі
 * зі стисненням): читаємо все тіло разом і проганяємо тим самим
 * розбором. Відповідь приїде одним шматком, але не зникне.
 */

export type SseEvent = { event: string; data: unknown };

function parseBlock(block: string): SseEvent | null {
  let name = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // пульс
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;

  try {
    return { event: name, data: JSON.parse(dataLines.join("\n")) };
  } catch {
    return null;
  }
}

export async function readSse(
  res: Response,
  onEvent: (e: SseEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  if (!res.body) {
    const text = await res.text();
    for (const block of text.replace(/\r\n/g, "\n").split("\n\n")) {
      const parsed = parseBlock(block);
      if (parsed) onEvent(parsed);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    for (;;) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.replace(/\r\n/g, "\n").split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const parsed = parseBlock(block);
        if (parsed) onEvent(parsed);
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // З'єднання вже закрите — нормально.
    }
  }
}
