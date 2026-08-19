/*
 * Псевдо-3D нахил фото товару за курсором (perspective + rotate).
 * Справжнього обертання на 360° без 3D-моделей чи серій фото не буває,
 * але нахил з інерцією дає той самий «живий» ефект на звичайних фото.
 *
 * Пишемо transform напряму в style без re-render: mousemove сиплеться
 * десятками на секунду, ганяти через React-стан його не можна. Плавність
 * дає transition-transform, який уже висить на самому <img>.
 */
let canTilt: boolean | null = null;

function tiltAllowed(): boolean {
  if (canTilt === null) {
    canTilt =
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover) and (pointer: fine)").matches &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  return canTilt;
}

export function tiltMove(e: { currentTarget: HTMLElement; clientX: number; clientY: number }) {
  if (!tiltAllowed()) return;
  const img = e.currentTarget.querySelector("img");
  if (!img) return;
  const r = e.currentTarget.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width - 0.5;
  const py = (e.clientY - r.top) / r.height - 0.5;
  img.style.transform = `perspective(600px) rotateY(${(px * 18).toFixed(1)}deg) rotateX(${(-py * 14).toFixed(1)}deg) scale(1.08)`;
}

export function tiltReset(e: { currentTarget: HTMLElement }) {
  const img = e.currentTarget.querySelector("img");
  if (img) img.style.transform = "";
}
