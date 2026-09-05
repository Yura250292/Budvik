/**
 * Трек, поділений за способом пересування — для карти.
 *
 * Жив приватною функцією всередині роуту зміни торгового
 * (/api/admin/shifts/[id]), і саме там і був потрібен, поки день водія
 * малювався однією синьою лінією. Тепер його малює й карта водія: питання
 * «скільки проїхав» і «де стояв» у водія те саме, що в торгового, а от
 * відповідь була гірша — суцільна лінія, у якій вивантаження на ринку
 * виглядає як поїздка кварталом.
 *
 * Сусідні шматки ділять спільну точку (кінець одного = початок наступного),
 * тож лінія лишається суцільною: між двома поїздками видно, як людина
 * дійшла ногами, а не діра.
 *
 * Кожен шматок проходить через buildTrackPath окремо — інакше геометрія
 * розриву, яка висить на точці-кінці, лягла б не в той шматок.
 */

import { buildTrackPath } from "@/lib/track/gaps";
import { haversineM } from "@/lib/track/geo";
import { classifyMovement, type MoveSegment } from "@/lib/track/movement";
import { markRepeatPasses, type PassKind } from "@/lib/track/repeat-pass";
import { collapseSimultaneous, dropSpikes } from "@/lib/track/spikes";
import { matchDayPath } from "@/lib/track/road-match";

/**
 * Пауза між точками, після якої шлях між ними — здогад, а не вимір.
 *
 * Точка пишеться раз на двадцять секунд, тож півтори хвилини тиші означають,
 * що приймач або застосунок мовчали, і що робила машина в цей час, ми не
 * бачили.
 */
const UNKNOWN_MS = 90_000;

export type MovementPart = {
  mode: MoveSegment["mode"];
  path: Array<[number, number]>;
  km: number;
  minutes: number;
  /**
   * Чи їхав тут уперше за день.
   *
   * Тільки для їзди. Повернення по власному сліду на карті інакше не видно
   * взагалі: друга лінія лягає точно на першу, і день із двома заїздами в те
   * саме село виглядає як день з одним.
   */
  pass?: PassKind;
};

export type PartPoint = {
  lat: number;
  lng: number;
  recordedAt: Date;
  accuracyM?: number | null;
  gapGeometry?: unknown;
  /** Дорога, дорахована для розриву. Є — значить шлях відомий, а не здогад. */
  roadMetersFromPrev?: number | null;
  /** Що каже про рух сам прилад — головне свідчення проти хибної геометрії. */
  speedKmh?: number | null;
};

export async function splitByMovement(
  rawPoints: PartPoint[],
  onRoads: boolean
): Promise<MovementPart[]> {
  /**
   * Вуса прибираємо ПЕРЕД усім іншим — і перед класифікацією теж.
   *
   * Одна точка, що вистрілила вбік і вернулася, ламає не лише малюнок: вона
   * розриває ділянку надвоє й підмішує в стоянку «швидкість», через яку та
   * стає їздою. Те саме число, що й у пробігу (`shiftTrackKm`), інакше карта
   * й картка показували б різні дні.
   */
  const points = dropSpikes(collapseSimultaneous(rawPoints));
  const segments = classifyMovement(points);

  /**
   * Повторні проїзди шукаємо по ВСЬОМУ дню одразу, а не всередині відрізка:
   * назад людина повертається через годину й через кілька інших відрізків,
   * тож у межах одного це не видно ніколи.
   */
  const driveGap: boolean[] = new Array(Math.max(0, points.length - 1)).fill(false);
  for (const seg of segments) {
    if (seg.mode !== "DRIVE") continue;
    for (let i = seg.start; i < seg.end; i++) driveGap[i] = true;
  }
  const passes = markRepeatPasses(points, driveGap);

  /**
   * Де ми не бачили дороги.
   *
   * Ознака саме ЧАС, а не довжина: на трасі точка раз на двадцять секунд дає
   * пряму на пів кілометра, і шлях там відомий — машина їхала трасою. А от
   * коли між точками півтори хвилини й більше, планшет мовчав, і будь-яка
   * лінія між ними — здогад. Розрив, якому вже дорахована дорога
   * (`roadMetersFromPrev`), здогадом не вважаємо: там шлях відомий.
   */
  const unknownGap: boolean[] = new Array(Math.max(0, points.length - 1)).fill(false);
  for (let i = 0; i < points.length - 1; i++) {
    if (!driveGap[i]) continue;
    if (points[i + 1].roadMetersFromPrev != null) continue;
    unknownGap[i] =
      points[i + 1].recordedAt.getTime() - points[i].recordedAt.getTime() >= UNKNOWN_MS;
  }

  const parts: MovementPart[] = [];

  for (const seg of segments) {
    /**
     * Їзду ділимо ще й за повторами: один відрізок може початися новою
     * дорогою й закінчитися поверненням по старій, і намалювати його одним
     * кольором означало б збрехати про обидві половини.
     */
    if (seg.mode === "DRIVE") {
      let runStart = seg.start;
      for (let i = seg.start; i < seg.end; i++) {
        const isLast = i === seg.end - 1;
        const sameRun =
          !isLast && passes[i + 1] === passes[i] && unknownGap[i + 1] === unknownGap[i];
        if (sameRun) continue;
        parts.push(
          await drivePart(points, runStart, i + 1, passes[i], unknownGap[i], onRoads)
        );
        runStart = i + 1;
      }
      continue;
    }

    /**
     * Ходьба й стоянки — сирою ламаною завжди. Матчер на пішому сліді малює
     * поїздку, якої не було: він чесно веде вулицями петлю, яку людина
     * обійшла ногами (див. road-match).
     */
    const slice = points.slice(seg.start, seg.end + 1);
    parts.push({
      mode: seg.mode,
      path: buildTrackPath(slice),
      km: Math.round(seg.meters / 100) / 10,
      minutes: seg.minutes,
    });
  }
  return parts;
}

/**
 * Один шматок їзди: від точки `from` до точки `to` включно.
 *
 * Кілометри рахуємо самі, а не беремо з відрізка: після поділу за повторами
 * шматків більше, ніж відрізків, і число в кожного своє.
 */
async function drivePart(
  points: PartPoint[],
  from: number,
  to: number,
  pass: PassKind,
  unknown: boolean,
  onRoads: boolean
): Promise<MovementPart> {
  const slice = points.slice(from, to + 1);
  let meters = 0;
  for (let i = from; i < to; i++) {
    meters += haversineM(points[i].lat, points[i].lng, points[i + 1].lat, points[i + 1].lng);
  }
  /**
   * По дорогах кладемо лише на прохання: кожен такий розрахунок коштує
   * десятка запитів до OSRM, а картку зміни відкривають десятки разів на
   * день. Не вдалося — лишається та сама ламана, і це нікому нічого не псує.
   */
  const path =
    onRoads
      ? ((await matchDayPath(slice).catch(() => null)) ?? buildTrackPath(slice))
      : buildTrackPath(slice);

  return {
    mode: "DRIVE",
    path,
    km: Math.round(meters / 100) / 10,
    minutes: Math.round(
      (points[to].recordedAt.getTime() - points[from].recordedAt.getTime()) / 60_000
    ),
    pass,
    ...(unknown ? { unknown: true } : {}),
  };
}

/**
 * Скільки з денної їзди — повернення по власному сліду.
 *
 * Число для картки зміни: воно й є відповіддю на «що тут можна покращити».
 * Решта пробігу — це відстань між клієнтами, і вона від порядку об'їзду майже
 * не залежить, а от повторні проїзди прибираються саме ним.
 */
export function repeatSummary(parts: MovementPart[]): {
  km: number;
  sharePct: number;
  backKm: number;
  againKm: number;
} {
  const km = (kind: PassKind) =>
    parts.filter((p) => p.mode === "DRIVE" && p.pass === kind).reduce((a, p) => a + p.km, 0);

  const first = km("FIRST");
  const backKm = km("BACK");
  const againKm = km("AGAIN");
  const total = first + backKm + againKm;
  const repeat = backKm + againKm;

  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    km: round(repeat),
    sharePct: total > 0 ? Math.round((repeat / total) * 100) : 0,
    backKm: round(backKm),
    againKm: round(againKm),
  };
}
