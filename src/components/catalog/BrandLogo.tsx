import Image from "next/image";

/**
 * Значок бренда у змісті та фільтрах.
 *
 * Логотипи є лише для 16 брендів (public/brands), а брендів у базі 360, тож
 * решті малюємо плашку з кольором із Brand.color і першими літерами назви —
 * інакше половина змісту виглядала б порожньою.
 */
export default function BrandLogo({
  name,
  logo,
  color,
  size = 40,
}: {
  name: string;
  logo?: string;
  color?: string | null;
  size?: number;
}) {
  if (logo) {
    return (
      <div
        className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[#EFEFEF] bg-white"
        style={{ width: size, height: size }}
      >
        <Image
          src={logo}
          alt={name}
          width={size}
          height={size}
          className="h-full w-full object-contain p-1"
        />
      </div>
    );
  }

  const initials = name
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className="flex flex-shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{
        width: size,
        height: size,
        background: color || "#1A1A1A",
        fontSize: size * 0.36,
      }}
    >
      {initials || "•"}
    </div>
  );
}
