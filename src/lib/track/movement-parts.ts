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
import { classifyMovement, type MoveSegment } from "@/lib/track/movement";
import { matchDayPath } from "@/lib/track/road-match";

export type MovementPart = {
  mode: MoveSegment["mode"];
  path: Array<[number, number]>;
  km: number;
  minutes: number;
};

export type PartPoint = {
  lat: number;
  lng: number;
  recordedAt: Date;
  accuracyM?: number | null;
  gapGeometry?: unknown;
};

export async function splitByMovement(
  points: PartPoint[],
  onRoads: boolean
): Promise<MovementPart[]> {
  const segments = classifyMovement(points);
  const parts: MovementPart[] = [];

  for (const seg of segments) {
    const slice = points.slice(seg.start, seg.end + 1);
    /**
     * По дорогах кладемо лише їзду й лише на прохання.
     *
     * Прохання — бо кожен такий розрахунок коштує десятка запитів до OSRM, а
     * картку зміни відкривають десятки разів на день; лише їзду — бо матчер на
     * пішому сліді малює поїздку, якої не було (див. road-match).
     *
     * Не вдалося — лишається та сама ламана, що й досі: це малюнок, і його
     * відсутність нікому нічого не псує.
     */
    const path =
      onRoads && seg.mode === "DRIVE"
        ? ((await matchDayPath(slice).catch(() => null)) ?? buildTrackPath(slice))
        : buildTrackPath(slice);
    parts.push({
      mode: seg.mode,
      path,
      km: Math.round(seg.meters / 100) / 10,
      minutes: seg.minutes,
    });
  }
  return parts;
}
