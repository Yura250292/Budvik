"use client";

import { colorForRep } from "@/lib/routes/colors";

/**
 * Кружечок користувача: фото, а без нього — ініціал на кольоровому тлі.
 *
 * Колір беремо з тієї самої палітри, що й мапа напрямків (colorForRep), і за
 * тим самим правилом — хеш від id. Тож у списку, на мапі й у шапці людина
 * впізнається однаковим кольором, а не трьома різними.
 *
 * Фото через <img>, а не next/image: аватарки маленькі й лежать у R2 під
 * довільним хостом, тож оптимізація не варта налаштування remotePatterns.
 */
export function Avatar({
  name,
  id,
  src,
  color,
  size = 40,
}: {
  name?: string | null;
  /** Для детермінованого кольору тла. Без нього — сірий. */
  id?: string;
  src?: string | null;
  /** Явний колір користувача (User.color), якщо заданий. */
  color?: string | null;
  size?: number;
}) {
  const initial = name?.trim()?.charAt(0)?.toUpperCase() || "?";
  const bg = id ? colorForRep(id, color) : "#9CA3AF";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name || "Фото профілю"}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          borderRadius: "9999px",
          objectFit: "cover",
          flexShrink: 0,
          background: "#F3F4F6",
        }}
      />
    );
  }

  return (
    <div
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "9999px",
        background: bg,
        color: "white",
        fontWeight: 700,
        // Кегль від розміру кружечка, щоб ініціал не плавав при size=24 і size=80
        fontSize: Math.round(size * 0.42),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        lineHeight: 1,
      }}
    >
      {initial}
    </div>
  );
}
