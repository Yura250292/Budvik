import { redirect } from "next/navigation";

/**
 * Пульт треку переїхав у «Логістика → Стан планшетів» (13.09.2026).
 * Редірект, а не видалення: адресу тримають відкритою й пересилають у чаті.
 */
export default function TrackHealthRedirect() {
  redirect("/admin/logistics/devices");
}
