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
 *   act  активний модуль-приймач: o слухає JS, u не слухає, - немає; далі його черга
 *   mods живих екземплярів модуля / з них слухає JS (лише 1.6.7+)
 *   oc   скільки разів у активного спрацював onCreate; em/ef спроби й невдачі емітера
 *   svc  служба локації: * передній план, + без нього, - немає
 *   ex   остання смерть процесу: причина@час
 *   net  v перевірена мережа, c є без перевірки, - немає; gps 1/0; bk кошик; rs фонові обмеження
 *   oe   відкритих подій; qm — диспетчер у режимі черги (обидва в хвості: їх дублюють dir/qd)
 *
 * `dir` росте, а `fin` стоїть на нулі — диспетчер віддає події екземпляру модуля,
 * на який JS не підписаний. Саме так планшет Передрія не писав трек 17–22.09.2026:
 * 8619 відданих подій, жодної закритої, і всі прапорці стану при цьому справні.
 */

export type DispatchApp = {
  fg?: string;
  headless?: string;
  queued?: number;
  openEvents?: number;
  tasks?: string[];
  headlessRecord?: boolean;
  /** Кого саме диспетчер вибере для події (1.6.7+): id, чи слухає його JS, його черга. */
  activeId?: string;
  activeObserved?: boolean;
  activeQueue?: number;
};

/** Екземпляр TaskManagerInternalModule у процесі (1.6.7+). */
export type DispatchModule = {
  id?: string;
  seq?: number;
  createdAt?: number;
  observed?: boolean;
  emitter?: boolean;
  queue?: number;
  onCreate?: number;
  emits?: number;
};

export type TaskServiceDiag = {
  execDirect?: number;
  execQueued?: number;
  finished?: number;
  queuedMode?: boolean;
  /** Спроби емітера й ті з них, що впали (1.6.7+): мовчазна втрата події видима лише так. */
  emitAttempts?: number;
  emitFailed?: number;
  /** Скільки разів підписаний модуль перехопив реєстрацію і скільки затирань відхилено. */
  takeovers?: number;
  rejected?: number;
  log?: string[];
  state?: {
    apps?: Record<string, DispatchApp>;
    persisted?: Record<string, string[]>;
    modules?: DispatchModule[];
  };
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

export function modules(ts: TaskServiceDiag | undefined): DispatchModule[] {
  return ts?.state?.modules ?? [];
}

/**
 * Хто прийме наступну подію: `o` — модуль, на який підписався JS, `u` — той, у
 * кого черга росте без читача, `-` — модуля немає. Число поруч — його черга.
 */
function describeActive(app: DispatchApp | undefined): string | undefined {
  if (!app || app.activeObserved === undefined) return undefined;
  if (!app.activeId) return "-";
  return `${app.activeObserved ? "o" : "u"}${app.activeQueue ?? 0}`;
}

/** Скільки екземплярів модуля живі й скільки з них слухає JS: `1/1` — норма. */
function describeModules(ts: TaskServiceDiag | undefined): string | undefined {
  const list = modules(ts);
  if (!list.length) return undefined;
  return `${list.length}/${list.filter((m) => m.observed).length}`;
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
  add("t", list(app?.tasks));
  add("ps", list(persisted));
  add("j", s.jobs ? `${s.jobs.length}/${locJobs.reduce((a, j) => a + (j.data ?? 0), 0)}` : undefined);
  add("br", lc?.broadcasts);
  add("sc", lc?.jobsScheduled);
  add("jx", lc?.jobsExecuted);
  add("dir", ts?.execDirect);
  add("qd", ts?.execQueued);
  add("fin", ts?.finished);
  add("act", describeActive(app));
  add("mods", describeModules(ts));
  add("oc", modules(ts).find((m) => m.id === app?.activeId)?.onCreate);
  add("em", ts?.emitAttempts);
  add("ef", ts?.emitFailed);
  add("svc", s.services ? (service ? (service.endsWith("*") ? "*" : "+") : "-") : undefined);
  add("ex", lastExit?.at ? `${lastExit.reason ?? "?"}@${hm(lastExit.at)}` : undefined);
  add("net", s.network ? (s.network.validated ? "v" : s.network.active ? "c" : "-") : undefined);
  add("gps", s.location ? (s.location.gps ? 1 : 0) : undefined);
  add("bk", s.bucket ? s.bucket.replace(/\s+/g, "") : undefined);
  add("rs", typeof s.restricted === "boolean" ? (s.restricted ? 1 : 0) : undefined);
  /**
   * Два останні — навмисно в хвості: нотатка обрізається на 200 символах, а ці
   * числа дублюють `dir` і `qd`, тоді як `act`/`mods` вище не дублює ніщо.
   */
  add("oe", app?.openEvents);
  add("qm", ts?.queuedMode === undefined ? undefined : ts.queuedMode ? 1 : 0);
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
