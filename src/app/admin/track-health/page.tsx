import TrackHealthBoard from "./TrackHealthBoard";

/**
 * Пульт треку — окрема сторінка, а не вкладка.
 *
 * Її відкривають у мить, коли щось не так, і тримають відкритою; вкладка
 * всередині іншого розділу означала б два кліки й чужий стан поруч.
 */
export const metadata = { title: "Budvik — Чому не пишеться" };

export default function TrackHealthPage() {
  return <TrackHealthBoard />;
}
