/**
 * Проба голосів для озвучення помічника: OpenAI gpt-4o-mini-tts проти
 * Gemini 3.1 Flash TTS на одній і тій самій фразі.
 *
 * Навіщо. Системний синтезатор браузера українською звучить механічно
 * (скарга власника 24.09.2026). Якість на слух числом не виміряти, тож
 * проба кладе зразки поруч у сторінку для прослуховування й міряє час до
 * готового звуку — від нього залежить пауза в режимі розмови.
 *
 * READ ONLY щодо бази: жодного запиту до Postgres. До моделей — кілька
 * коротких фраз, частки цента.
 *
 *   npx tsx --env-file=.env scripts/probe-tts-voices.mts <тека для зразків>
 */

import { mkdirSync, writeFileSync } from "node:fs";

const OUT = process.argv[2] ?? "output/tts-voices";
mkdirSync(OUT, { recursive: true });

const TEXT =
  "Найбільше прострочив Гіжицький — вісімдесят п'ять тисяч гривень. Разом клієнти винні майже два мільйони, з них прострочено сімсот шістдесят сім тисяч. Таблиця на екрані.";

const STYLE =
  "Говори українською природно й спокійно, як досвідчений фінансовий помічник керівника: тепло, впевнено, діловим тоном, без театральності, у помірному темпі з природними паузами.";

type Sample = { id: string; label: string; file: string; ms: number; error?: string };
const samples: Sample[] = [];

async function openai(voice: string) {
  const t0 = Date.now();
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice, input: TEXT, instructions: STYLE, response_format: "mp3" }),
  });
  const ms = Date.now() - t0;
  const file = `openai-${voice}.mp3`;
  if (!res.ok) return samples.push({ id: file, label: `OpenAI · ${voice}`, file, ms, error: `${res.status} ${(await res.text()).slice(0, 200)}` });
  writeFileSync(`${OUT}/${file}`, Buffer.from(await res.arrayBuffer()));
  samples.push({ id: file, label: `OpenAI · ${voice}`, file, ms });
}

/** PCM 16 біт моно → WAV: Gemini віддає сирі відліки без заголовка. */
function wav(pcm: Buffer, rate = 24_000): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function gemini(voice: string, model = "gemini-3.1-flash-tts-preview") {
  const key = process.env.ASSISTANT_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
  const t0 = Date.now();
  // Класичний generateContent: той самий вхід, що вже працює в проєкті.
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${STYLE}\n\n${TEXT}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
    }),
  });
  const ms = Date.now() - t0;
  const file = `gemini-${voice}.wav`;
  const body = await res.text();
  if (!res.ok) return samples.push({ id: file, label: `Gemini · ${voice}`, file, ms, error: `${res.status} ${body.slice(0, 200)}` });
  const data = JSON.parse(body)?.candidates?.[0]?.content?.parts?.find((p: { inlineData?: { data: string } }) => p.inlineData)?.inlineData?.data;
  if (!data) return samples.push({ id: file, label: `Gemini · ${voice}`, file, ms, error: `немає аудіо: ${body.slice(0, 200)}` });
  writeFileSync(`${OUT}/${file}`, wav(Buffer.from(data, "base64")));
  samples.push({ id: file, label: `Gemini · ${voice}`, file, ms });
}

await Promise.all([
  openai("marin"),
  openai("cedar"),
  openai("coral"),
  openai("ash"),
  gemini("Kore"),
  gemini("Charon"),
  gemini("Aoede"),
  gemini("Orus"),
]);

samples.sort((a, b) => a.label.localeCompare(b.label));
for (const s of samples) console.log(`${s.label.padEnd(18)} ${String(s.ms).padStart(6)} мс  ${s.error ?? "ok"}`);

writeFileSync(
  `${OUT}/index.html`,
  `<!doctype html><meta charset="utf-8"><title>Голоси помічника</title>
<body style="font-family:system-ui;max-width:640px;margin:32px auto;padding:0 16px">
<h2>Голоси помічника — та сама фраза</h2><p style="color:#555">${TEXT}</p>
${samples
  .filter((s) => !s.error)
  .map((s) => `<p><b>${s.label}</b> · ${(s.ms / 1000).toFixed(1)} с<br><audio controls preload="auto" src="${s.file}" style="width:100%"></audio></p>`)
  .join("\n")}
</body>`
);
console.log(`\nСторінка: ${OUT}/index.html\nNothing was written to the database.`);
