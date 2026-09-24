/**
 * Програвач живого голосу помічника: сирий звук із /api/sales/assistant/speak.
 *
 * Сервер віддає PCM (16 біт, 24 кГц, моно) потоком — перший шматок через
 * ~1,2 с, хоча вся репліка синтезується довше (див. lib/assistant/tts.ts).
 * <audio> такий формат не грає, тож шматки складаються в AudioBuffer і
 * ставляться в чергу Web Audio один за одним, без щілин.
 *
 * ЗАПАС НА СТАРТІ. Перші 0,3 с набираємо, перш ніж грати: інакше мережеве
 * тремтіння між шматками дає тріск і паузи посеред слова. Синтез іде
 * швидше, ніж мовлення (13,6 с звуку за 5,1 с), тож далі черга не
 * вичерпується.
 */

const RATE = 24_000;
/** Скільки набрати, перш ніж почати, і якими порціями ставити в чергу. */
const START_SAMPLES = RATE * 0.3;
const BATCH_SAMPLES = RATE * 0.2;

let context: AudioContext | null = null;
let active: { stop: () => void } | null = null;

/**
 * Контекст звуку — один на сторінку. Браузер тримає його на паузі до
 * першого дотику людини, тож `resume` у кожному виклику: режим розмови й
 * кнопка «Вголос» запускаються саме натисканням.
 */
function audioContext(): AudioContext | null {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return null;
  if (!context || context.state === "closed") context = new AudioContext();
  void context.resume().catch(() => {});
  return context;
}

export function stopCloudSpeech(): void {
  active?.stop();
  active = null;
}

/**
 * Сказати текст живим голосом.
 *
 * Повертає false, якщо звук так і не почався (немає синтезу, мережа, 503) —
 * тоді викликач озвучує системним голосом. `onEnd` приходить рівно один
 * раз: коли договорив, коли перебили або коли потік обірвався посередині.
 */
export async function playCloudSpeech(text: string, onEnd: () => void): Promise<boolean> {
  stopCloudSpeech();
  const ctx = audioContext();
  if (!ctx) return false;

  const abort = new AbortController();
  const sources = new Set<AudioBufferSourceNode>();
  let finished = false;
  let stopped = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (active === handle) active = null;
    onEnd();
  };
  const handle = {
    stop: () => {
      stopped = true;
      abort.abort();
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          // ще не стартував або вже відграв
        }
      }
      sources.clear();
      finish();
    },
  };
  active = handle;

  let res: Response;
  try {
    res = await fetch(`/api/sales/assistant/speak?t=${encodeURIComponent(text)}`, { signal: abort.signal });
  } catch {
    if (active === handle) active = null;
    return false;
  }
  if (!res.ok || !res.body || stopped) {
    if (active === handle) active = null;
    return stopped;
  }

  const reader = res.body.getReader();
  let pending: Float32Array[] = [];
  let pendingLength = 0;
  let leftover: number | null = null;
  let nextAt = 0;
  let started = false;
  /**
   * Потік скінчився. «Договорив» = потік скінчився І відграв останній
   * шматок: якщо черга спорожніла посеред репліки (мережа відстала), це ще
   * не кінець — інакше розмова відкрила б мікрофон під останні слова.
   */
  let streamDone = false;
  let last: AudioBufferSourceNode | null = null;

  const schedule = () => {
    if (pendingLength === 0) return;
    const buffer = ctx.createBuffer(1, pendingLength, RATE);
    const channel = buffer.getChannelData(0);
    let offset = 0;
    for (const part of pending) {
      channel.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingLength = 0;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    // Черга відстала (вкладка у фоні, мережа) — продовжуємо з «зараз», а не з минулого.
    nextAt = Math.max(nextAt, ctx.currentTime + 0.02);
    source.start(nextAt);
    nextAt += buffer.duration;
    sources.add(source);
    source.onended = () => {
      sources.delete(source);
      if (source === last && streamDone && !stopped) finish();
    };
    last = source;
    started = true;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || stopped) break;
      // Шматки не вирівняні по 2 байти: зайвий байт чекає на пару з наступного.
      let bytes = value;
      if (leftover !== null) {
        const joined = new Uint8Array(bytes.length + 1);
        joined[0] = leftover;
        joined.set(bytes, 1);
        bytes = joined;
        leftover = null;
      }
      if (bytes.length % 2 === 1) {
        leftover = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const samples = new Float32Array(bytes.length / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      pending.push(samples);
      pendingLength += samples.length;

      if (pendingLength >= (started ? BATCH_SAMPLES : START_SAMPLES)) schedule();
    }
  } catch {
    // обрив посередині — дограємо, що встигло прийти
  }
  if (stopped) return true;
  streamDone = true;
  schedule();
  if (!started) {
    if (active === handle) active = null;
    return false;
  }
  // Усе вже відграло, поки чекали кінця потоку, — onended більше не прийде.
  if (sources.size === 0) finish();
  return true;
}
