import { redirect } from "next/navigation";

/**
 * «Статистика» переїхала в «Аналітику»: вкладка «Закупівлі» — це та сама
 * половина сторінки, а блок продажів дублював вкладки «Огляд» і «Торгові».
 *
 * Редірект, а не видалення: посилання на /admin/erp/stats розійшлися по
 * закладках. API /api/erp/stats лишається — саме він живить нову вкладку.
 */
export default function StatsRedirect() {
  redirect("/admin/analytics?tab=purchases");
}
