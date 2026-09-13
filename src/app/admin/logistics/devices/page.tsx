import TrackHealthBoard from "./TrackHealthBoard";

/**
 * «Стан планшетів» — пульт «чому не пишеться».
 *
 * Жив окремою сторінкою /admin/track-health, бо його відкривають у мить, коли
 * щось не так, і тримають відкритим. У «Логістиці» він лишається окремою
 * адресою (а не вкладкою в чужому стані) — просто тепер поруч із картою, на
 * якій ця поламка й видна.
 */
export const metadata = { title: "Budvik — Стан планшетів" };

export default function DevicesPage() {
  return <TrackHealthBoard />;
}
