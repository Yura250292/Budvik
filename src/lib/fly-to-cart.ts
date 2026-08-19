/*
 * «Політ у кошик»: клон зображення товару летить у видиму іконку кошика
 * ([data-cart-target] у шапці на десктопі або в нижньому таб-барі на
 * мобільному). WAAPI без залежностей; при reduced-motion не робимо
 * нічого — лічильник кошика і так оновиться миттєво.
 */
export function flyToCart(from: HTMLElement) {
  if (typeof window === "undefined") return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (typeof from.animate !== "function") return;

  // Ціль — той з кошиків, який зараз видимий (другий схований через display:none)
  const target = Array.from(
    document.querySelectorAll<HTMLElement>("[data-cart-target]")
  ).find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (!target) return;

  const img = from.closest("a")?.querySelector("img") ?? null;
  const source = img ?? from;
  const s = source.getBoundingClientRect();
  if (s.width === 0 && s.height === 0) return;
  const t = target.getBoundingClientRect();

  const size = Math.min(Math.max(s.width, 24), 96);

  const ghost = img ? (img.cloneNode(true) as HTMLElement) : document.createElement("div");
  ghost.removeAttribute("class");
  if (!img) {
    ghost.style.background = "#FFD600";
    ghost.style.borderRadius = "50%";
  }
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${s.left + s.width / 2 - size / 2}px`,
    top: `${s.top + s.height / 2 - size / 2}px`,
    width: `${size}px`,
    height: `${size}px`,
    objectFit: "contain",
    margin: "0",
    padding: "0",
    zIndex: "100",
    pointerEvents: "none",
    willChange: "transform, opacity",
  });
  document.body.appendChild(ghost);

  const dx = t.left + t.width / 2 - (s.left + s.width / 2);
  const dy = t.top + t.height / 2 - (s.top + s.height / 2);

  const anim = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      // Дуга: спершу трохи вгору, потім у ціль
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 40}px) scale(0.55)`, opacity: 0.9, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.15)`, opacity: 0.25 },
    ],
    { duration: 500, easing: "cubic-bezier(0.32, 0.72, 0, 1)" }
  );
  anim.onfinish = () => ghost.remove();
  anim.oncancel = () => ghost.remove();
}
