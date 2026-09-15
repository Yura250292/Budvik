/**
 * Наради й задачі команді — типи, статуси, підписи.
 *
 * Чистий модуль: без Prisma і без next/*. Його читають і сторінки адмінки та
 * кабінету, і воркер, тож нічого серверного сюди класти не можна.
 */

/* ---------- Нарада ---------- */

/**
 * DRAFT → UPLOADED → TRANSCRIBING → TRANSCRIBED → SUMMARIZING → READY | FAILED.
 * Текстова нотатка стартує одразу з TRANSCRIBED: розпізнавати в ній нічого.
 */
export const MEETING_STATUSES = [
  "DRAFT",
  "UPLOADED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "SUMMARIZING",
  "READY",
  "FAILED",
] as const;
export type MeetingStatus = (typeof MEETING_STATUSES)[number];

export const MEETING_STATUS_LABELS: Record<MeetingStatus, string> = {
  DRAFT: "Чернетка",
  UPLOADED: "У черзі",
  TRANSCRIBING: "Розпізнаю мовлення…",
  TRANSCRIBED: "У черзі на підсумок",
  SUMMARIZING: "Складаю підсумок…",
  READY: "Готово",
  FAILED: "Помилка",
};

/** Стани, у яких сторінка наради опитує сервер: воркер ще працює. */
export const POLLING_STATES: readonly MeetingStatus[] = ["UPLOADED", "TRANSCRIBING", "TRANSCRIBED", "SUMMARIZING"];

export function asMeetingStatus(value: string): MeetingStatus {
  return (MEETING_STATUSES as readonly string[]).includes(value) ? (value as MeetingStatus) : "DRAFT";
}

/**
 * Персонал, якому можна доручати: і для промпту моделі, і для вибору виконавця.
 * Не «усі, крім CLIENT»: є ще оптовики (WHOLESALE), а вони не команда.
 */
export const STAFF_ROLE_LIST = ["SALES", "DRIVER", "WAREHOUSE", "MANAGER", "ADMIN"] as const;

/** Назва, яку людина не міняла: її можна замінити запропонованою моделлю. */
export const AUTO_TITLE = /^Нарада(\s+\d{1,2}\.\d{1,2}\.\d{2,4}(,?\s+\d{1,2}:\d{2})?)?$/i;

/** «Нарада 14.09.2026 10:30» за київським часом. */
export function defaultMeetingTitle(at: Date): string {
  const day = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", day: "2-digit", month: "2-digit", year: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" }).format(at);
  return `Нарада ${day} ${time}`;
}

/** Мітка останнього тіку воркера в SyncState: без неї забутий деплой виглядає як вічний спінер. */
export const MEETINGS_TICK_KEY = "meetings:lastTick";
/** Тік старший за це, а в черзі щось є — обробник не працює. */
export const MEETINGS_TICK_STALE_MS = 2 * 60_000;

/** Одна репліка з розпізнавання: хто, коли (мс від початку), що сказав. */
export type Utterance = { speaker: string; start: number; end: number; text: string };

/** Іменована сутність з аудіо: ім'я, сума, організація — у правильному написанні. */
export type MeetingEntity = { type: string; text: string };

/** Хто є хто за лейблом розпізнавання: { "A": { name, userId } }. */
export type SpeakerMap = Record<string, { name: string | null; userId: string | null }>;

export type MeetingSpeaker = {
  label: string;
  guessedName: string | null;
  userId: string | null;
  role: string | null;
  evidence: string;
};

export type MeetingTaskProposal = {
  title: string;
  details: string | null;
  assigneeUserId: string | null;
  assigneeNameHeard: string | null;
  clientNameHeard: string | null;
  clientHint: string | null;
  /** YYYY-MM-DD за Києвом або null. */
  dueDate: string | null;
  priority: TaskPriority;
  evidence: string | null;
};

export const PROGRESS_STATUSES = ["DONE", "IN_PROGRESS", "BLOCKED", "NOT_STARTED"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];
export const PROGRESS_LABELS: Record<ProgressStatus, string> = {
  DONE: "Зроблено",
  IN_PROGRESS: "У процесі",
  BLOCKED: "Застрягло",
  NOT_STARTED: "Не починали",
};

export type MeetingProgressUpdate = {
  taskId: string;
  taskTitle: string;
  status: ProgressStatus;
  note: string;
};

/** Структурований підсумок, як його зберігає Meeting.structured. */
export type MeetingStructured = {
  suggestedTitle: string;
  summary: string;
  speakers: MeetingSpeaker[];
  keyPoints: string[];
  decisions: string[];
  tasks: MeetingTaskProposal[];
  progressUpdates: MeetingProgressUpdate[];
  openQuestions: string[];
};

/* ---------- Задачі ---------- */

export const TASK_STATUSES = ["PROPOSED", "ASSIGNED", "DONE", "CANCELLED"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  PROPOSED: "Чекає підтвердження",
  ASSIGNED: "Надіслано",
  DONE: "Виконано",
  CANCELLED: "Скасовано",
};

export const TASK_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Не горить",
  NORMAL: "Звичайна",
  HIGH: "Термінова",
};

export function asTaskStatus(value: string): TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value) ? (value as TaskStatus) : "PROPOSED";
}
export function asTaskPriority(value: unknown): TaskPriority {
  return typeof value === "string" && (TASK_PRIORITIES as readonly string[]).includes(value)
    ? (value as TaskPriority)
    : "NORMAL";
}

/**
 * Упевненість прив'язки.
 *
 * Виконавця назвала модель зі списку персоналу — SURE. Виконавця підставлено
 * за закріпленням клієнта — GUESS: у «Надіслати всі» така задача не йде, бо
 * говорили, можливо, про іншу людину.
 */
export const CONFIDENCE_SURE = 0.9;
export const CONFIDENCE_GUESS = 0.6;

export type ClientCandidate = { id: string; name: string; address: string | null; mine: boolean };

/**
 * Задачу можна надіслати разом з іншими без перевірки: виконавця назвали на
 * нараді й він є в списку, а клієнт — якщо звучав — прив'язаний однозначно.
 */
export function isTaskReady(t: {
  status: string;
  assigneeId: string | null;
  assigneeConfidence: number | null;
  clientNameHeard: string | null;
  counterpartyId: string | null;
}): boolean {
  return (
    t.status === "PROPOSED" &&
    !!t.assigneeId &&
    (t.assigneeConfidence ?? 0) >= CONFIDENCE_SURE &&
    (!t.clientNameHeard || !!t.counterpartyId)
  );
}

export type TaskRow = {
  id: string;
  meetingId: string | null;
  meetingTitle: string | null;
  title: string;
  details: string | null;
  status: TaskStatus;
  statusLabel: string;
  priority: TaskPriority;
  /** ISO, кінець дня за Києвом. */
  dueAt: string | null;
  overdue: boolean;
  assignee: { id: string; name: string; role: string } | null;
  assigneeNameHeard: string | null;
  assigneeConfidence: number | null;
  counterparty: { id: string; name: string } | null;
  clientNameHeard: string | null;
  clientHint: string | null;
  clientCandidates: ClientCandidate[];
  clientConfidence: number | null;
  createdBy: { id: string; name: string };
  sentAt: string | null;
  pushedAt: string | null;
  doneAt: string | null;
  doneNote: string | null;
  cancelledAt: string | null;
  progressNote: string | null;
  progressAt: string | null;
  createdAt: string;
  /** Можна надіслати без перевірки: виконавець упевнений, клієнт (якщо звучав) прив'язаний. */
  ready: boolean;
};

export type StaffOption = { id: string; name: string; role: string; roleLabel: string };

/* ---------- Рядки для сторінок ---------- */

export type MeetingRow = {
  id: string;
  title: string;
  description: string | null;
  status: MeetingStatus;
  statusLabel: string;
  recordedAt: string;
  createdAt: string;
  createdBy: { id: string; name: string };
  isTextNote: boolean;
  hasAudio: boolean;
  audioMimeType: string | null;
  audioSizeBytes: number | null;
  audioDurationMs: number | null;
  processingError: string | null;
  tasksProposed: number;
  tasksSent: number;
  /** Скільком людям надіслано підсумок (./share.ts). */
  sharedCount: number;
};

export type MeetingDetail = MeetingRow & {
  noteText: string | null;
  transcript: string | null;
  utterances: Utterance[];
  speakerCount: number | null;
  speakerMap: SpeakerMap;
  summary: string | null;
  structured: MeetingStructured | null;
  aiModel: string | null;
  aiPromptTokens: number | null;
  aiCompletionTokens: number | null;
  transcribeAttempts: number;
  summarizeAttempts: number;
  processedAt: string | null;
  tasks: TaskRow[];
  worker: WorkerState;
};

/** Стан обробника: коли востаннє тікав, чи не завмер і яких ключів йому бракує. */
export type WorkerState = { lastTickAt: string | null; stale: boolean; missing: string[] };

/* ---------- Підсумок для команди ---------- */

/**
 * Кому керівник надсилає підсумок: тим, у кого є кабінет із розділом «Наради».
 * Менеджер і адмін працюють в адмінці — кабінетна сторінка їм ні до чого.
 */
export const SHARE_ROLE_LIST = ["SALES", "DRIVER", "WAREHOUSE"] as const;

/** Стільки після надсилання підсумок «новий»: мітка в списку й лічильник на вході. */
export const SHARE_NEW_MS = 3 * 86_400_000;

export type ShareRecipient = {
  id: string;
  name: string;
  role: string;
  roleLabel: string;
  /** Коли надіслано; null — цій людині ще не надсилали. */
  sharedAt: string | null;
  /** Коли пішов пуш; null — лише в кабінеті (надіслали поза робочими годинами). */
  pushedAt: string | null;
};

export type ShareState = {
  people: ShareRecipient[];
  /** Кого відмітити в списку одразу: усіх торгових і виконавців надісланих задач. */
  suggested: string[];
  /** Зараз робочі години — пуш піде одразу. */
  pushHours: boolean;
};

/** Чужа задача наради в кабінеті: хто, що, для кого й до коли — без службових полів. */
export type TeamTask = {
  id: string;
  title: string;
  done: boolean;
  priority: TaskPriority;
  dueAt: string | null;
  overdue: boolean;
  assigneeName: string | null;
  assigneeRoleLabel: string | null;
  clientName: string | null;
};

export type SharedMeetingRow = {
  id: string;
  title: string;
  recordedAt: string;
  audioDurationMs: number | null;
  createdByName: string;
  sharedAt: string;
  isNew: boolean;
  /** Перше речення підсумку. */
  teaser: string;
  decisions: number;
  /** Відкриті задачі цієї людини з наради. */
  myOpenTasks: number;
};

export type SharedProgress = {
  taskTitle: string;
  assigneeName: string | null;
  status: ProgressStatus;
  note: string;
};

export type SharedMeetingView = Omit<SharedMeetingRow, "teaser" | "decisions" | "myOpenTasks"> & {
  /** Підсумок перескладають просто зараз — показано попередню версію. */
  updating: boolean;
  summary: string | null;
  decisions: string[];
  keyPoints: string[];
  openQuestions: string[];
  progress: SharedProgress[];
  /** Задачі цієї людини — з кнопкою «Виконано», як у «Задачах від офісу». */
  mine: TaskRow[];
  team: TeamTask[];
};

/* ---------- Дрібниці ---------- */

/** 754000 → «12:34», 3 723 000 → «01:02:03». */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** «Speaker A» і «A» — один лейбл. */
export function speakerKey(label: string): string {
  return label.replace(/^speaker\s+/i, "").trim().toUpperCase();
}

/** Розібрати Meeting.speakerMap із бази; зіпсоване мовчки відкидається. */
export function parseSpeakerMap(raw: unknown): SpeakerMap {
  const out: SpeakerMap = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [label, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    out[speakerKey(label)] = {
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim() : null,
      userId: typeof o.userId === "string" && o.userId ? o.userId : null,
    };
  }
  return out;
}
