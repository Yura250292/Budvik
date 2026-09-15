/**
 * Нативний маяк планшета: стислий рядок у журнал і розбір назад.
 *
 * Навіщо. 15.09.2026 трек трьох торгових стояв годинами, а сервер не бачив
 * нічого: заморожений застосунок не шле пульсу, бо пульс — теж JS. З 1.6.6
 * track-guard сам, без JS, на кожному будильнику відправляє знімок стану
 * (/api/track/native-beacon). Повний знімок лежить останнім у SyncState, а
 * історія — рядками `native` у TrackEvent. Колонка нотатки має 200 символів,
 * тож формат «ключ=значення»: його читає і людина, і звіт за день.
 *
 * Ключі:
 *   r    причина: alarm | boot | updated | manual
 *   p    коли піднявся процес (Київ)
 *   tm   чи бачить диспетчер контекст JS: перша літера — звичайна реєстрація,
 *        друга — безінтерфейсна; L жива, C зібрана GC, - немає. «--» = заморожено
 *   q    подій у черзі без читача; oe — відкритих подій; qm — диспетчер у режимі черги
 *   t    завдання в пам'яті диспетчера; ps — збережені в налаштуваннях
 *   j    робіт у JobScheduler / координат у роботах локації
 *   br   сигналів від системи з координатами; sc — робіт доставки поставлено;
 *        jx — виконано
 *   dir  подій віддано JS напряму; qd — у чергу; fin — закрито JS
 *   svc  служба локації: * передній план, + без нього, - немає
 *   ex   остання смерть процесу: причина@час
 *   net  v перевірена мережа, c є без перевірки, - немає; gps 1/0; bk кошик; rs фонові обмеження
 */

export type DispatchApp = {
  fg?: string;
  headless?: string;
  queued?: number;
  openEvents?: number;
  tasks?: string[];
  headlessRecord?: boolean;
};

export type TaskServiceDiag = {
  execDirect?: number;
  execQueued?: number;
  finished?: number;
  queuedMode?: boolean;
  log?: string[];
  state?: { apps?: Record<string, DispatchApp>; persisted?: Record<string, string[]> };
};

export type LocationConsumerDiag = {
  broadcasts?: number;
  jobsScheduled?: number;
  jobsExecuted?: number;
  [key: string]: unknown;
};

export type NativeSnapshot = {
  at?: number;
  process?: { pid?: number; startedAt?: number; importance?: number };
  exits?: Array<{ at?: number; reason?: string; desc?: string; importance?: number }>;
  bucket?: string;
  services?: string[];
  restricted?: boolean | null;
  location?: { gps?: boolean; enabled?: boolean };
  network?: { active?: boolean; validated?: boolean };
  jobs?: Array<{ task?: string | null; data?: number }>;
  taskService?: TaskServiceDiag | string;
  locationConsumer?: LocationConsumerDiag | string;
  [key: string]: unknown;
};

export type NativeBeaconBody = {
  reason?: string;
  at?: number;
  build?: string;
  snapshot?: NativeSnapshot;
};

const TASK_SHORT: Record<string, string> = {
  "budvik-track-location": "loc",
  "budvik-track-watchdog": "wd",
  "budvik-track-wake": "wake",
  "budvik-after-shift-geofence": "geo",
};

const short = (name: string) => TASK_SHORT[name] ?? name.replace(/^budvik-/, "").slice(0, 6);

function asObject<T>(v: T | string | undefined): T | undefined {
  return v && typeof v === "object" ? v : undefined;
}

const ref = (s?: string) => (s === "live" ? "L" : s === "collected" ? "C" : "-");

const hm = (ms: number) =>
  new Date(ms).toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });

/** Запис застосунку в диспетчері — той, де найбільше завдань (у bare він один). */
export function mainDispatchApp(ts: TaskServiceDiag | undefined): DispatchApp | undefined {
  const apps = Object.values(ts?.state?.apps ?? {});
  return apps.sort((a, b) => (b.tasks?.length ?? 0) - (a.tasks?.length ?? 0))[0];
}

export function summarizeNative(body: NativeBeaconBody): string {
  const s = body.snapshot ?? {};
  const ts = asObject(s.taskService);
  const lc = asObject(s.locationConsumer);
  const app = mainDispatchApp(ts);
  const persisted = Object.values(ts?.state?.persisted ?? {})[0];
  const service = (s.services ?? []).find((x) => x.startsWith("LocationTaskService"));
  const lastExit = s.exits?.[0];
  const locJobs = (s.jobs ?? []).filter((j) => j.task === "budvik-track-location");

  const parts: string[] = [];
  const add = (k: string, v: unknown) => {
    if (v !== undefined && v !== null && v !== "") parts.push(`${k}=${v}`);
  };
  const list = (names?: string[]) => (names ? (names.length ? names.map(short).join(",") : "0") : undefined);

  add("r", body.reason);
  add("p", s.process?.startedAt ? hm(s.process.startedAt) : undefined);
  add("tm", app ? `${ref(app.fg)}${ref(app.headless)}` : ts ? "--" : undefined);
  add("q", app?.queued);
  add("oe", app?.openEvents);
  add("qm", ts?.queuedMode === undefined ? undefined : ts.queuedMode ? 1 : 0);
  add("t", list(app?.tasks));
  add("ps", list(persisted));
  add("j", s.jobs ? `${s.jobs.length}/${locJobs.reduce((a, j) => a + (j.data ?? 0), 0)}` : undefined);
  add("br", lc?.broadcasts);
  add("sc", lc?.jobsScheduled);
  add("jx", lc?.jobsExecuted);
  add("dir", ts?.execDirect);
  add("qd", ts?.execQueued);
  add("fin", ts?.finished);
  add("svc", s.services ? (service ? (service.endsWith("*") ? "*" : "+") : "-") : undefined);
  add("ex", lastExit?.at ? `${lastExit.reason ?? "?"}@${hm(lastExit.at)}` : undefined);
  add("net", s.network ? (s.network.validated ? "v" : s.network.active ? "c" : "-") : undefined);
  add("gps", s.location ? (s.location.gps ? 1 : 0) : undefined);
  add("bk", s.bucket ? s.bucket.replace(/\s+/g, "") : undefined);
  add("rs", typeof s.restricted === "boolean" ? (s.restricted ? 1 : 0) : undefined);
  return parts.join(" ").slice(0, 200);
}

export function parseNativeNote(note: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (note ?? "").split(" ")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}
