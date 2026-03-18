"use client";

import { useRef, useEffect, useState } from "react";

interface Props {
  type: "cutting" | "grinding" | "drilling";
  dataReady?: boolean;
  onComplete?: () => void;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  color: string; size: number;
  type: "spark" | "smoke" | "chip";
}

interface MetricBubble {
  label: string;
  icon: string;
  progress: number;
  delay: number;
}

const TIPS: Record<string, string[]> = {
  cutting: [
    "Аналізуємо знос диску...",
    "Обчислюємо швидкість різання...",
    "Вимірюємо нагрів в зоні різу...",
    "AI шукає відгуки в інтернеті...",
    "Визначаємо ефективність...",
    "Порівнюємо з реальними тестами...",
  ],
  grinding: [
    "Аналізуємо якість шліфування...",
    "Вимірюємо знімання матеріалу...",
    "Контролюємо температуру поверхні...",
    "AI порівнює з реальними тестами...",
    "Визначаємо точність обробки...",
    "Обчислюємо ресурс диску...",
  ],
  drilling: [
    "Аналізуємо подачу свердла...",
    "Вимірюємо якість отвору...",
    "Контролюємо нагрів свердла...",
    "AI шукає характеристики...",
    "Визначаємо продуктивність...",
    "Обчислюємо знос ріжучого краю...",
  ],
};

export default function InteractiveSimCanvas({ type, dataReady, onComplete }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Keep a ref so the rAF draw closure always reads the latest dataReady value.
  // Without this, dataReady is stale in the closure (captured once when type changes).
  const dataReadyRef = useRef(dataReady);
  useEffect(() => {
    dataReadyRef.current = dataReady;
    // When a new simulation starts (dataReady resets to false), reset animation state
    // so completionFired from a previous run doesn't block the next one.
    if (!dataReady) {
      const S = stateRef.current;
      S.dataReadySeen = false;
      S.completionFired = false;
      S.elapsed = 0;
      S.particles = [];
      S.metrics.forEach(m => { m.progress = 0; });
    }
  }, [dataReady]);

  const stateRef = useRef({
    elapsed: 0,
    toolAngle: 0,
    heatGlow: 0,
    particles: [] as Particle[],
    dataReadySeen: false,
    completionFired: false,
    metrics: [
      { label: "Знос",        icon: "⚙️", progress: 0, delay: 0   },
      { label: "Нагрів",      icon: "🌡️", progress: 0, delay: 1.5 },
      { label: "Ефективність",icon: "⚡", progress: 0, delay: 3   },
      { label: "Час",         icon: "⏱️", progress: 0, delay: 4.5 },
      { label: "Точність",    icon: "🎯", progress: 0, delay: 6   },
    ] as MetricBubble[],
  });

  const [currentTip, setCurrentTip] = useState(0);

  useEffect(() => {
    const tips = TIPS[type];
    const interval = setInterval(() => {
      setCurrentTip(prev => (prev + 1) % tips.length);
    }, 3000);
    return () => clearInterval(interval);
  }, [type]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const S = stateRef.current;
    // Reset state on type change
    S.elapsed = 0;
    S.toolAngle = 0;
    S.heatGlow = 0;
    S.particles = [];
    S.dataReadySeen = false;
    S.completionFired = false;
    S.metrics.forEach(m => { m.progress = 0; });

    let lastTime = performance.now();

    const spawnSparks = (x: number, y: number, count: number, intense: boolean, dirX = 1, dirY = 0.5) => {
      if (S.particles.length > 280) return;
      for (let i = 0; i < count; i++) {
        const spread = intense ? 0.9 : 0.5;
        const angle = Math.atan2(dirY, dirX) + (Math.random() - 0.5) * spread * Math.PI;
        const speed = 2 + Math.random() * (intense ? 7 : 4);
        S.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1, maxLife: 0.25 + Math.random() * 0.5,
          color: `hsl(${28 + Math.random() * 22}, 100%, ${58 + Math.random() * 32}%)`,
          size: 1 + Math.random() * 2.5, type: "spark",
        });
      }
    };

    const spawnChips = (x: number, y: number, count: number) => {
      if (S.particles.length > 280) return;
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 0.7;
        const speed = 1.5 + Math.random() * 3;
        S.particles.push({
          x, y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1, maxLife: 0.6 + Math.random() * 0.8,
          color: `rgba(${160 + Math.random() * 50}, ${130 + Math.random() * 40}, ${80 + Math.random() * 40}, 0.85)`,
          size: 1.5 + Math.random() * 2.5, type: "chip",
        });
      }
    };

    const draw = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;
      S.elapsed += dt;

      const W = canvas.width / dpr;
      const H = canvas.height / dpr;

      ctx.clearRect(0, 0, W, H);

      // Background
      const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
      bgGrad.addColorStop(0, "#0c0c0c");
      bgGrad.addColorStop(1, "#181818");
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // Subtle grid
      ctx.strokeStyle = "rgba(255,255,255,0.022)";
      ctx.lineWidth = 1;
      for (let i = 0; i < W; i += 40) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, H); ctx.stroke(); }
      for (let i = 0; i < H; i += 40) { ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(W, i); ctx.stroke(); }

      // ─── Phase logic (synced with dataReady) ───
      const CYCLE = 9;
      const WORK = 0.67; // phase reaches 1.0 at this fraction of cycle
      const cycleT = S.elapsed % CYCLE;

      // Mark when data becomes ready — use ref to avoid stale closure
      if (dataReadyRef.current && !S.dataReadySeen) S.dataReadySeen = true;

      let phase: number;
      if (S.completionFired) {
        // Freeze at 1 — results are being revealed
        phase = 1.0;
      } else if (S.dataReadySeen) {
        // Data ready: finish current cycle then stop
        phase = Math.min(1, cycleT / (CYCLE * WORK));
        if (cycleT >= CYCLE * WORK && !S.completionFired) {
          S.completionFired = true;
          // All metrics must be at 100% instantly
          S.metrics.forEach(m => { m.progress = 1; });
          setTimeout(() => onCompleteRef.current?.(), 80);
        }
      } else {
        // Still loading — loop normally
        phase = cycleT < CYCLE * WORK ? cycleT / (CYCLE * WORK) : 1.0;
      }

      S.toolAngle += dt * 20;
      S.heatGlow = Math.min(1, phase * 1.8);

      // Draw the specific operation
      if (type === "cutting") {
        drawCutting(ctx, W, H, dt, S, phase, spawnSparks);
      } else if (type === "grinding") {
        drawGrinding(ctx, W, H, dt, S, phase, spawnSparks);
      } else {
        drawDrilling(ctx, W, H, dt, S, phase, spawnSparks, spawnChips);
      }

      // Particles
      for (let i = S.particles.length - 1; i >= 0; i--) {
        const p = S.particles[i];
        p.life -= dt / p.maxLife;
        if (p.life <= 0) { S.particles.splice(i, 1); continue; }
        p.x += p.vx;
        p.y += p.vy;
        if (p.type === "spark") p.vy += 0.18;
        if (p.type === "chip")  p.vy += 0.22;
        if (p.type === "smoke") { p.vy -= 0.2; p.size += dt * 5; }

        ctx.globalAlpha = p.life * (p.type === "smoke" ? 0.55 : 1);
        if (p.type === "spark") {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size * p.life;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 3, p.y - p.vy * 3);
          ctx.stroke();
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.4, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      // Metric bubbles
      const bpos = [
        { x: W - 102, y: 24 },
        { x: W - 102, y: 62 },
        { x: W - 102, y: 100 },
        { x: 8, y: 24 },
        { x: 8, y: 62 },
      ];
      for (let i = 0; i < S.metrics.length; i++) {
        const m = S.metrics[i];
        const bp = bpos[i];
        const mt = Math.max(0, S.elapsed - m.delay);
        if (mt <= 0) continue;
        m.progress = Math.min(1, mt / 5.5);

        const alpha = Math.min(1, mt * 2);
        const pulse = 1 + Math.sin(S.elapsed * 2.5 + i * 1.2) * 0.025;

        ctx.save();
        ctx.globalAlpha = alpha * 0.92;
        ctx.translate(bp.x, bp.y);
        ctx.scale(pulse, pulse);

        const pw = 92;
        ctx.fillStyle = "rgba(0,0,0,0.68)";
        ctx.beginPath(); ctx.roundRect(0, -11, pw, 22, 11); ctx.fill();

        ctx.fillStyle = m.progress >= 1 ? "rgba(34,197,94,0.55)" : "rgba(255,214,0,0.38)";
        ctx.beginPath(); ctx.roundRect(2, -9, (pw - 4) * m.progress, 18, 9); ctx.fill();

        ctx.fillStyle = "#fff";
        ctx.font = "bold 9.5px system-ui";
        ctx.textAlign = "left";
        ctx.fillText(`${m.icon} ${m.label}`, 6, 3);

        if (m.progress >= 1) {
          ctx.fillStyle = "#22C55E"; ctx.font = "bold 11px system-ui";
          ctx.textAlign = "right"; ctx.fillText("✓", pw - 5, 4);
        } else {
          ctx.fillStyle = "rgba(255,255,255,0.5)"; ctx.font = "9px system-ui";
          ctx.textAlign = "right"; ctx.fillText(`${Math.round(m.progress * 100)}%`, pw - 5, 3);
        }
        ctx.restore();
      }

      if (S.particles.length > 300) S.particles.splice(0, S.particles.length - 300);
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [type]);

  const tips = TIPS[type];

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#0c0c0c]" style={{ height: 340 }}>
      <canvas ref={canvasRef} className="w-full h-full" />

      {/* Completion flash overlay */}
      {dataReady && (
        <div className="absolute inset-0 pointer-events-none animate-fade-in"
          style={{ background: "radial-gradient(ellipse at center, rgba(34,197,94,0.12) 0%, transparent 70%)" }} />
      )}

      {/* Floating tip */}
      <div className="absolute bottom-4 left-0 right-0 flex justify-center pointer-events-none">
        <div
          key={dataReady ? "ready" : currentTip}
          className="bg-black/70 backdrop-blur-sm text-white/90 text-xs sm:text-sm px-5 py-2.5 rounded-full border border-white/10 animate-fade-in"
        >
          {dataReady ? "✓ Аналіз завершено — готуємо звіт..." : tips[currentTip]}
        </div>
      </div>

      {/* Badge */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 pointer-events-none">
        <div className="relative w-5 h-5">
          <div className="absolute inset-0 rounded-full border-2 border-[#FFD600]/30" />
          <div className={`absolute inset-0 rounded-full border-2 border-transparent border-t-[#FFD600] ${dataReady ? "" : "animate-spin"}`}
            style={dataReady ? { borderColor: "#22C55E", transform: "rotate(0deg)" } : {}} />
        </div>
        <span className={`text-xs font-bold tracking-wider uppercase ${dataReady ? "text-[#22C55E]" : "text-[#FFD600]"}`}>
          {dataReady ? "Готово!" : "AI Симуляція"}
        </span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// CUTTING — grinder moves across material, kerf opens up
// ═══════════════════════════════════════════════════════
function drawCutting(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, phase: number,
  spawnSparks: (x: number, y: number, count: number, intense: boolean, dirX?: number, dirY?: number) => void
) {
  const eased = easeInOut(phase);

  // ─── Material block (3D isometric-ish) ───
  const bx = W * 0.08;
  const by = H * 0.42;
  const bw = W * 0.84;
  const bh = H * 0.34;
  const thick = 14; // top face thickness

  // Cut X position across the block
  const cutX = bx + bw * eased;

  // Left part (already cut) — slightly separated
  const sepOffset = eased * 4;

  // Top face - left piece
  const topGradL = ctx.createLinearGradient(bx, by - thick, bx + cutX, by);
  topGradL.addColorStop(0, "#5a5a5a");
  topGradL.addColorStop(1, "#484848");
  ctx.fillStyle = topGradL;
  ctx.beginPath();
  ctx.moveTo(bx,       by - sepOffset);
  ctx.lineTo(bx + thick, by - thick - sepOffset);
  ctx.lineTo(cutX + thick, by - thick - sepOffset);
  ctx.lineTo(cutX,     by - sepOffset);
  ctx.closePath(); ctx.fill();

  // Front face - left piece
  const frontGradL = ctx.createLinearGradient(bx, by, bx, by + bh);
  frontGradL.addColorStop(0, "#525252");
  frontGradL.addColorStop(0.5, "#3c3c3c");
  frontGradL.addColorStop(1, "#2c2c2c");
  ctx.fillStyle = frontGradL;
  ctx.fillRect(bx, by - sepOffset, cutX - bx, bh);

  // Right piece (stationary)
  const topGradR = ctx.createLinearGradient(cutX, by - thick, bx + bw, by);
  topGradR.addColorStop(0, "#484848");
  topGradR.addColorStop(1, "#3e3e3e");
  ctx.fillStyle = topGradR;
  ctx.beginPath();
  ctx.moveTo(cutX,       by);
  ctx.lineTo(cutX + thick, by - thick);
  ctx.lineTo(bx + bw + thick, by - thick);
  ctx.lineTo(bx + bw,   by);
  ctx.closePath(); ctx.fill();

  const frontGradR = ctx.createLinearGradient(cutX, by, cutX, by + bh);
  frontGradR.addColorStop(0, "#484848");
  frontGradR.addColorStop(0.5, "#363636");
  frontGradR.addColorStop(1, "#262626");
  ctx.fillStyle = frontGradR;
  ctx.fillRect(cutX, by, bw - (cutX - bx), bh);

  // Side face right piece
  ctx.fillStyle = "#2e2e2e";
  ctx.beginPath();
  ctx.moveTo(bx + bw, by);
  ctx.lineTo(bx + bw + thick, by - thick);
  ctx.lineTo(bx + bw + thick, by + bh - thick);
  ctx.lineTo(bx + bw, by + bh);
  ctx.closePath(); ctx.fill();

  // ─── Kerf (cut slot) ───
  if (eased > 0.005) {
    const kerfW = 4;
    // Dark slot in material
    ctx.fillStyle = "rgba(0,0,0,0.85)";
    ctx.fillRect(cutX - kerfW / 2, by - sepOffset, kerfW, bh);

    // Glowing kerf edges
    ctx.shadowColor = "#FF8800";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = `rgba(255, 160, 0, ${0.4 + S.heatGlow * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cutX - kerfW / 2, by - sepOffset); ctx.lineTo(cutX - kerfW / 2, by + bh - sepOffset); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cutX + kerfW / 2, by); ctx.lineTo(cutX + kerfW / 2, by + bh); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ─── Depth progress bar ───
  const barX = W * 0.94;
  const barY = by;
  const barH = bh;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.roundRect(barX, barY, 6, barH, 3); ctx.fill();
  ctx.fillStyle = "#FFD600";
  ctx.beginPath(); ctx.roundRect(barX, barY, 6, barH * eased, 3); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px system-ui"; ctx.textAlign = "center";
  ctx.fillText(`${Math.round(eased * 100)}%`, barX + 3, by + barH + 14);

  // ─── Angle grinder ───
  const discR = 28;
  const toolX = cutX;
  const toolY = by - sepOffset - discR + 4;

  ctx.save();
  ctx.translate(toolX, toolY);

  // Grinder body
  const bodyGrad = ctx.createLinearGradient(-20, -50, 20, 0);
  bodyGrad.addColorStop(0, "#2a2a2a");
  bodyGrad.addColorStop(0.5, "#444");
  bodyGrad.addColorStop(1, "#323232");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.moveTo(-14, -50); ctx.lineTo(14, -50);
  ctx.lineTo(18, -8);  ctx.lineTo(-18, -8);
  ctx.closePath(); ctx.fill();

  // Side handle
  ctx.fillStyle = "#1e1e1e";
  ctx.beginPath(); ctx.roundRect(-45, -40, 28, 13, 5); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.lineWidth = 1;
  for (let xi = -42; xi < -20; xi += 4) {
    ctx.beginPath(); ctx.moveTo(xi, -39); ctx.lineTo(xi, -28); ctx.stroke();
  }

  // Gear housing
  ctx.fillStyle = "#383838";
  ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#555"; ctx.lineWidth = 2; ctx.stroke();

  // Spinning disc
  ctx.save();
  ctx.rotate(S.toolAngle);
  const dg = ctx.createRadialGradient(0, 0, 2, 0, 0, discR);
  dg.addColorStop(0, "#999");
  dg.addColorStop(0.4, "#666");
  dg.addColorStop(0.85, "#555");
  dg.addColorStop(1, "#444");
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(0, 0, discR, 0, Math.PI * 2); ctx.fill();
  // Motion blur lines
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 0.7;
  for (let ri = 0; ri < 10; ri++) {
    const a = (ri / 10) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5);
    ctx.lineTo(Math.cos(a) * discR, Math.sin(a) * discR); ctx.stroke();
  }
  // Outer ring (wear edge)
  ctx.strokeStyle = "rgba(255,200,80,0.3)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, discR - 1, 0, Math.PI * 2); ctx.stroke();
  // Center
  ctx.fillStyle = "#888"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Heat glow at contact
  if (S.heatGlow > 0.1) {
    const gr = 18 + S.heatGlow * 22;
    const glow = ctx.createRadialGradient(0, discR - 4, 0, 0, discR - 4, gr);
    glow.addColorStop(0, `rgba(255, 200, 0, ${S.heatGlow * 0.7})`);
    glow.addColorStop(0.4, `rgba(255, 100, 0, ${S.heatGlow * 0.4})`);
    glow.addColorStop(1, "rgba(255, 50, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, discR - 4, gr, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();

  // Sparks from contact point — spray diagonally right+down
  if (phase > 0.01 && phase < 0.99) {
    spawnSparks(toolX + 4, toolY + discR - 2, 3 + Math.floor(S.heatGlow * 3), S.heatGlow > 0.5, 0.7, 0.9);
  }
}

// ════════════════════════════════════════════════════════════════
// DRILLING — side view, drill descends into material, hole deepens
// ════════════════════════════════════════════════════════════════
function drawDrilling(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, phase: number,
  spawnSparks: (x: number, y: number, count: number, intense: boolean, dirX?: number, dirY?: number) => void,
  spawnChips: (x: number, y: number, count: number) => void
) {
  const eased = easeInOut(phase);
  const cx = W * 0.5;

  // ─── Material block ───
  const matTop = H * 0.38;
  const matH   = H * 0.46;
  const matW   = W * 0.72;
  const matX   = (W - matW) / 2;

  // Top face (perspective top)
  const topFaceH = 12;
  const tg = ctx.createLinearGradient(matX, matTop - topFaceH, matX, matTop);
  tg.addColorStop(0, "#5c5c5c");
  tg.addColorStop(1, "#4a4a4a");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(matX, matTop);
  ctx.lineTo(matX + topFaceH, matTop - topFaceH);
  ctx.lineTo(matX + matW + topFaceH, matTop - topFaceH);
  ctx.lineTo(matX + matW, matTop);
  ctx.closePath(); ctx.fill();

  // Front face
  const fg = ctx.createLinearGradient(matX, matTop, matX, matTop + matH);
  fg.addColorStop(0, "#525252");
  fg.addColorStop(0.5, "#3e3e3e");
  fg.addColorStop(1, "#282828");
  ctx.fillStyle = fg;
  ctx.fillRect(matX, matTop, matW, matH);

  // Right face
  ctx.fillStyle = "#303030";
  ctx.beginPath();
  ctx.moveTo(matX + matW, matTop);
  ctx.lineTo(matX + matW + topFaceH, matTop - topFaceH);
  ctx.lineTo(matX + matW + topFaceH, matTop + matH - topFaceH);
  ctx.lineTo(matX + matW, matTop + matH);
  ctx.closePath(); ctx.fill();

  // Surface scratches texture
  ctx.strokeStyle = "rgba(255,255,255,0.035)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 18; i++) {
    const sx = matX + (i / 17) * matW;
    ctx.beginPath(); ctx.moveTo(sx, matTop); ctx.lineTo(sx, matTop + matH); ctx.stroke();
  }

  // ─── Hole in material (getting deeper) ───
  const holeW = 20;
  const maxHoleDepth = matH * 0.85;
  const holeDepth = eased * maxHoleDepth;
  const holeX = cx - holeW / 2;

  if (eased > 0.005) {
    // Hole opening on top face
    ctx.fillStyle = "#0a0a0a";
    ctx.beginPath();
    ctx.ellipse(cx, matTop, holeW / 2, 5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Hole interior (getting deeper)
    const hg = ctx.createLinearGradient(cx, matTop, cx, matTop + holeDepth);
    hg.addColorStop(0, "#111");
    hg.addColorStop(0.6, "#0d0d0d");
    hg.addColorStop(1, "#080808");
    ctx.fillStyle = hg;
    ctx.fillRect(holeX, matTop, holeW, holeDepth);

    // Hole walls — gradient to give depth illusion
    const wallL = ctx.createLinearGradient(holeX, 0, holeX + 5, 0);
    wallL.addColorStop(0, "rgba(60,60,60,0.7)");
    wallL.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wallL;
    ctx.fillRect(holeX, matTop, 8, holeDepth);

    const wallR = ctx.createLinearGradient(holeX + holeW, 0, holeX + holeW - 5, 0);
    wallR.addColorStop(0, "rgba(60,60,60,0.7)");
    wallR.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = wallR;
    ctx.fillRect(holeX + holeW - 8, matTop, 8, holeDepth);

    // Heat glow at drill tip (inside hole)
    const tipY = matTop + holeDepth;
    if (S.heatGlow > 0.1 && holeDepth < maxHoleDepth) {
      const glow = ctx.createRadialGradient(cx, tipY, 0, cx, tipY, 20);
      glow.addColorStop(0, `rgba(255, 200, 0, ${S.heatGlow * 0.7})`);
      glow.addColorStop(0.5, `rgba(255, 80, 0, ${S.heatGlow * 0.3})`);
      glow.addColorStop(1, "rgba(255, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, tipY, 20, 0, Math.PI * 2); ctx.fill();
    }

    // Chip ejection from hole opening
    if (phase > 0.02 && phase < 0.96 && Math.random() < 0.35) {
      spawnChips(cx + (Math.random() - 0.5) * holeW, matTop - 2, 1);
    }
  }

  // ─── Depth ruler (right side) ───
  const rulerX = matX + matW + 22;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.roundRect(rulerX, matTop, 5, matH, 2.5); ctx.fill();
  if (eased > 0) {
    const dg = ctx.createLinearGradient(0, matTop, 0, matTop + holeDepth);
    dg.addColorStop(0, "#FFD600");
    dg.addColorStop(1, "#FF6600");
    ctx.fillStyle = dg;
    ctx.beginPath(); ctx.roundRect(rulerX, matTop, 5, holeDepth, 2.5); ctx.fill();
    // Ruler label
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = "9px system-ui"; ctx.textAlign = "center";
    ctx.fillText(`${Math.round(eased * 100)}%`, rulerX + 2.5, matTop + holeDepth + 14);
  }
  // Ruler ticks
  ctx.strokeStyle = "rgba(255,255,255,0.2)"; ctx.lineWidth = 1;
  for (let ri = 0; ri <= 4; ri++) {
    const ty = matTop + (ri / 4) * matH;
    ctx.beginPath(); ctx.moveTo(rulerX - 4, ty); ctx.lineTo(rulerX + 5, ty); ctx.stroke();
  }

  // ─── Drill bit (side view) ───
  const drillLength = 90;
  const tipOffset = 8; // tip pointiness
  // Drill descends: starts above material, goes into hole
  const drillTipY = matTop + holeDepth;
  const drillBodyTop = drillTipY - drillLength;
  const halfW = 8;

  ctx.save();
  ctx.translate(cx + (Math.sin(S.elapsed * 18) * 0.8 * (phase > 0.02 ? 1 : 0)), 0); // vibration

  // Drill shank (top part - cylindrical)
  const shankGrad = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
  shankGrad.addColorStop(0, "#2a2a2a");
  shankGrad.addColorStop(0.3, "#666");
  shankGrad.addColorStop(0.7, "#888");
  shankGrad.addColorStop(1, "#444");
  ctx.fillStyle = shankGrad;
  ctx.fillRect(-halfW, drillBodyTop, halfW * 2, drillLength - tipOffset);

  // Flutes (spiral lines)
  ctx.strokeStyle = "rgba(100,100,100,0.7)"; ctx.lineWidth = 1.5;
  const fluteSpacing = 12;
  const fluteOffset = (S.toolAngle * 4) % fluteSpacing;
  for (let fi = -2; fi < drillLength / fluteSpacing + 2; fi++) {
    const fy = drillBodyTop + fi * fluteSpacing + fluteOffset;
    if (fy < drillBodyTop || fy > drillTipY - tipOffset) continue;
    ctx.beginPath();
    ctx.moveTo(-halfW, fy);
    ctx.bezierCurveTo(-halfW * 0.3, fy + 3, halfW * 0.3, fy - 3, halfW, fy);
    ctx.stroke();
  }

  // Highlight
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(-halfW + 2, drillBodyTop, 3, drillLength - tipOffset);

  // Tip (pointed)
  ctx.fillStyle = "#aaa";
  ctx.beginPath();
  ctx.moveTo(-halfW, drillTipY - tipOffset);
  ctx.lineTo(halfW, drillTipY - tipOffset);
  ctx.lineTo(0, drillTipY);
  ctx.closePath(); ctx.fill();

  // Tip glint
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.moveTo(-halfW + 2, drillTipY - tipOffset);
  ctx.lineTo(0, drillTipY - 2);
  ctx.lineTo(0, drillTipY - tipOffset);
  ctx.closePath(); ctx.fill();

  // Chuck above drill
  const chuckY = drillBodyTop - 20;
  const chuckGrad = ctx.createLinearGradient(-14, 0, 14, 0);
  chuckGrad.addColorStop(0, "#1e1e1e");
  chuckGrad.addColorStop(0.4, "#555");
  chuckGrad.addColorStop(0.6, "#666");
  chuckGrad.addColorStop(1, "#2e2e2e");
  ctx.fillStyle = chuckGrad;
  ctx.beginPath(); ctx.roundRect(-14, chuckY, 28, 24, 3); ctx.fill();
  // Chuck ring lines
  ctx.strokeStyle = "rgba(255,255,255,0.1)"; ctx.lineWidth = 1;
  for (let ri = 0; ri < 4; ri++) {
    ctx.beginPath(); ctx.moveTo(-14, chuckY + 4 + ri * 5); ctx.lineTo(14, chuckY + 4 + ri * 5); ctx.stroke();
  }

  // Drill motor body above chuck
  const motorGrad = ctx.createLinearGradient(-18, 0, 18, 0);
  motorGrad.addColorStop(0, "#1a1a1a");
  motorGrad.addColorStop(0.5, "#333");
  motorGrad.addColorStop(1, "#222");
  ctx.fillStyle = motorGrad;
  ctx.beginPath(); ctx.roundRect(-18, chuckY - 50, 36, 52, 6); ctx.fill();
  // Ventilation slits
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  for (let vi = 0; vi < 6; vi++) {
    ctx.beginPath(); ctx.moveTo(-14, chuckY - 45 + vi * 7); ctx.lineTo(14, chuckY - 45 + vi * 7); ctx.stroke();
  }

  // Sparks from tip when in material
  if (phase > 0.05 && phase < 0.96 && S.heatGlow > 0.2) {
    const tipAbsY = drillTipY;
    if (holeDepth > 5) {
      // sparks escape upward through the hole
      spawnSparks(0, matTop - 3, 2, S.heatGlow > 0.6, 0, -1);
    }
  }

  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// GRINDING — grinder oscillates, surface progressively ground
// ═══════════════════════════════════════════════════════════
function drawGrinding(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, phase: number,
  spawnSparks: (x: number, y: number, count: number, intense: boolean, dirX?: number, dirY?: number) => void
) {
  const surfY = H * 0.58;
  const surfH = H * 0.28;

  // ─── Surface block (isometric top view-ish) ───
  const bx = W * 0.08;
  const bw = W * 0.84;
  const tph = 12;

  // Top face
  const tg = ctx.createLinearGradient(bx, surfY - tph, bx, surfY);
  tg.addColorStop(0, "#5a5a5a"); tg.addColorStop(1, "#484848");
  ctx.fillStyle = tg;
  ctx.beginPath();
  ctx.moveTo(bx, surfY); ctx.lineTo(bx + tph, surfY - tph);
  ctx.lineTo(bx + bw + tph, surfY - tph); ctx.lineTo(bx + bw, surfY);
  ctx.closePath(); ctx.fill();

  // Front face
  const fg = ctx.createLinearGradient(bx, surfY, bx, surfY + surfH);
  fg.addColorStop(0, "#505050"); fg.addColorStop(0.5, "#3c3c3c"); fg.addColorStop(1, "#262626");
  ctx.fillStyle = fg;
  ctx.fillRect(bx, surfY, bw, surfH);

  // Right face
  ctx.fillStyle = "#2c2c2c";
  ctx.beginPath();
  ctx.moveTo(bx + bw, surfY); ctx.lineTo(bx + bw + tph, surfY - tph);
  ctx.lineTo(bx + bw + tph, surfY + surfH - tph); ctx.lineTo(bx + bw, surfY + surfH);
  ctx.closePath(); ctx.fill();

  // ─── Grinding marks (appear as grinder passes) ───
  // The grinder sweeps back and forth; each pass leaves a polished strip
  // We show accumulated polished area up to phase * full width
  const polishedW = bw * Math.min(1, phase * 1.3);
  if (polishedW > 2) {
    // Polished strip on top face
    const polGrad = ctx.createLinearGradient(bx, surfY, bx + polishedW, surfY);
    polGrad.addColorStop(0, "rgba(180, 180, 180, 0.25)");
    polGrad.addColorStop(0.7, "rgba(200, 200, 200, 0.18)");
    polGrad.addColorStop(1, "rgba(255, 255, 255, 0.05)");
    ctx.fillStyle = polGrad;
    ctx.fillRect(bx, surfY, polishedW, 4);

    // Scratch lines on front face
    const lineCount = Math.floor(polishedW / 6);
    ctx.strokeStyle = "rgba(255, 214, 0, 0.1)";
    ctx.lineWidth = 1;
    for (let li = 0; li < lineCount; li++) {
      const lx = bx + li * 6 + 2;
      ctx.beginPath(); ctx.moveTo(lx, surfY + 1); ctx.lineTo(lx, surfY + surfH * 0.6); ctx.stroke();
    }

    // Polished sheen — bright highlight on top
    ctx.fillStyle = `rgba(255, 255, 255, ${0.06 + phase * 0.1})`;
    ctx.fillRect(bx, surfY - 2, polishedW, 3);
  }

  // ─── Grinder oscillates left→right→left ───
  // Two passes per cycle: goes right then comes back
  const passes = 2;
  const passPhase = (phase * passes) % 1;
  const goingRight = Math.floor(phase * passes) % 2 === 0;
  const toolX = bx + (goingRight ? passPhase : 1 - passPhase) * bw;
  const toolY = surfY - 32;

  ctx.save();
  ctx.translate(toolX, toolY);

  // Tilt the grinder slightly
  ctx.rotate(goingRight ? -0.2 : 0.2);

  // Grinder body
  const bodyGrad = ctx.createLinearGradient(-18, -55, 18, 0);
  bodyGrad.addColorStop(0, "#303030"); bodyGrad.addColorStop(0.5, "#484848"); bodyGrad.addColorStop(1, "#383838");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.roundRect(-20, -60, 40, 56, 6); ctx.fill();

  // Handle (side)
  ctx.fillStyle = "#1e1e1e";
  ctx.beginPath(); ctx.roundRect(-38, -48, 22, 13, 4); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  for (let xi = -36; xi < -18; xi += 4) {
    ctx.beginPath(); ctx.moveTo(xi, -47); ctx.lineTo(xi, -36); ctx.stroke();
  }

  // Gear housing
  ctx.fillStyle = "#3a3a3a";
  ctx.beginPath(); ctx.arc(0, 0, 17, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#555"; ctx.lineWidth = 2; ctx.stroke();

  // Spinning disc (slightly elliptical — angled view)
  ctx.save();
  ctx.rotate(S.toolAngle);
  ctx.scale(1, 0.45);
  const dg2 = ctx.createRadialGradient(0, 0, 2, 0, 0, 26);
  dg2.addColorStop(0, "#888"); dg2.addColorStop(0.45, "#666");
  dg2.addColorStop(0.85, "#555"); dg2.addColorStop(1, "#444");
  ctx.fillStyle = dg2;
  ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
  // Motion arcs
  ctx.strokeStyle = "rgba(255,255,255,0.15)"; ctx.lineWidth = 0.7;
  for (let ri2 = 0; ri2 < 8; ri2++) {
    const a = (ri2 / 8) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
    ctx.lineTo(Math.cos(a) * 26, Math.sin(a) * 26); ctx.stroke();
  }
  ctx.fillStyle = "#888"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Heat glow at contact
  if (S.heatGlow > 0.1) {
    const glow = ctx.createRadialGradient(0, 14, 0, 0, 14, 22 + S.heatGlow * 16);
    glow.addColorStop(0, `rgba(255, 180, 0, ${S.heatGlow * 0.65})`);
    glow.addColorStop(0.5, `rgba(255, 80, 0, ${S.heatGlow * 0.3})`);
    glow.addColorStop(1, "rgba(255, 0, 0, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 14, 22 + S.heatGlow * 16, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();

  // Fine sparks upward from contact
  if (phase > 0.01 && phase < 0.99) {
    spawnSparks(toolX, surfY - 4, 2 + Math.floor(S.heatGlow * 2), S.heatGlow > 0.5, goingRight ? 0.3 : -0.3, -1);
  }

  // ─── Depth/progress indicator ───
  const barX = W * 0.94;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.roundRect(barX, surfY, 6, surfH, 3); ctx.fill();
  const progH = surfH * Math.min(1, phase * 1.3);
  ctx.fillStyle = "#FFD600";
  ctx.beginPath(); ctx.roundRect(barX, surfY, 6, progH, 3); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px system-ui"; ctx.textAlign = "center";
  ctx.fillText(`${Math.round(Math.min(100, phase * 130))}%`, barX + 3, surfY + surfH + 14);
}

// Simple ease-in-out
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}
