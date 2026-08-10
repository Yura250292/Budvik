import { RepProfile } from "./components/RepProfile";
import { kyivDate } from "@/lib/date/kyiv";

/**
 * Профіль окремого торгового.
 *
 * Окремий маршрут, а не панель поверх списку: посилання на «Кулик за
 * жовтень» можна переслати, а кнопка «Назад» повертає до списку, а не
 * закриває всю сторінку.
 */
export default async function RepPage({
  params,
  searchParams,
}: {
  params: Promise<{ repId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { repId } = await params;
  const { from, to } = await searchParams;

  const today = kyivDate(new Date());
  const period =
    from && to ? { from, to } : { from: `${today.slice(0, 7)}-01`, to: today };

  return <RepProfile repId={repId} initialPeriod={period} />;
}
