"use client";

import { useRef, useEffect, useState } from "react";

interface Props {
  type: "cutting" | "grinding" | "drilling";
  dataReady?: boolean;
  onComplete?: () => void;
  expectedMs?: number; // estimated AI processing time in ms — animation duration
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

export default function InteractiveSimCanvas({ type, dataReady, onComplete, expectedMs }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  // Keep refs so rAF draw closure always reads the latest prop values (stale closure fix)
  const dataReadyRef = useRef(dataReady);
  const expectedMsRef = useRef(expectedMs ?? 13000);
  useEffect(() => { expectedMsRef.current = expectedMs ?? 13000; }, [expectedMs]);

  useEffect(() => {
    dataReadyRef.current = dataReady;
    // When a new simulation starts (dataReady resets to false), reset animation state
    // so completionFired from a previous run doesn't block the next one.
    if (!dataReady) {
      const S = stateRef.current;
      S.dataReadySeen = false;
      S.completionFired = false;
      S.completionStarted = false;
      S.completionFromPhase = 0;
      S.completionProgress = 0;
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
    completionStarted: false,
    completionFromPhase: 0,
    completionProgress: 0,
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
      // Mark when data becomes ready — use ref to avoid stale closure
      if (dataReadyRef.current && !S.dataReadySeen) S.dataReadySeen = true;

      // Animation = loading bar calibrated to expected AI response time.
      // Loading: linear 0→0.96 over expectedMs seconds, then holds at 0.96.
      // Data ready: smoothly finishes 0.96→1.0 over ~1s, then reveals results.
      const EXPECTED_S = expectedMsRef.current / 1000;

      let phase: number;
      if (S.completionFired) {
        // Freeze — results already revealed
        phase = 1.0;
      } else if (S.dataReadySeen) {
        // Data is ready: lock current position and advance to 1.0 over ~1s
        if (!S.completionStarted) {
          S.completionStarted = true;
          S.completionFromPhase = Math.min(0.96, S.elapsed / EXPECTED_S);
          S.completionProgress = 0;
        }
        S.completionProgress = Math.min(1, S.completionProgress + dt / 1.0);
        phase = S.completionFromPhase + (1 - S.completionFromPhase) * S.completionProgress;
        if (S.completionProgress >= 1 && !S.completionFired) {
          S.completionFired = true;
          S.metrics.forEach(m => { m.progress = 1; });
          setTimeout(() => onCompleteRef.current?.(), 80);
        }
      } else {
        // Loading: linear 0→0.96 over expectedMs, then asymptotic creep 0.96→0.995
        // (always moving — like Chrome tab progress bar — never freezes, never reaches 1)
        if (S.elapsed <= EXPECTED_S) {
          phase = (S.elapsed / EXPECTED_S) * 0.96;
        } else {
          const overtime = S.elapsed - EXPECTED_S;
          // Exponential decay: gets slower and slower, asymptote ≈ 0.995
          phase = 0.96 + 0.035 * (1 - Math.exp(-overtime * 0.12));
        }
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
// CUTTING — grinder descends vertically, splits material in two
// ═══════════════════════════════════════════════════════
function drawCutting(
  ctx: CanvasRenderingContext2D, W: number, H: number, dt: number,
  S: any, phase: number,
  spawnSparks: (x: number, y: number, count: number, intense: boolean, dirX?: number, dirY?: number) => void
) {
  const eased = easeInOut(phase);

  // ─── Material block ───
  const cx   = W * 0.50;         // vertical cut line (center)
  const matY = H * 0.28;
  const matH = H * 0.42;
  const matW = W * 0.78;
  const matX = (W - matW) / 2;
  const toph = 13;               // 3D top-face depth
  const kerfW = 5;

  // Pieces drift apart horizontally once cut passes 35%
  const sep = Math.max(0, (eased - 0.35) / 0.65) * 16;

  const lEnd = cx - kerfW / 2;   // right edge of left piece
  const rSt  = cx + kerfW / 2;   // left edge of right piece

  // ── LEFT PIECE ──
  ctx.save();
  ctx.translate(-sep, 0);
  // top face
  const tgL = ctx.createLinearGradient(matX, matY - toph, lEnd, matY);
  tgL.addColorStop(0, "#5c5c5c"); tgL.addColorStop(1, "#4a4a4a");
  ctx.fillStyle = tgL;
  ctx.beginPath();
  ctx.moveTo(matX,        matY);
  ctx.lineTo(matX + toph, matY - toph);
  ctx.lineTo(lEnd + toph, matY - toph);
  ctx.lineTo(lEnd,        matY);
  ctx.closePath(); ctx.fill();
  // front face
  const fgL = ctx.createLinearGradient(0, matY, 0, matY + matH);
  fgL.addColorStop(0, "#525252"); fgL.addColorStop(0.5, "#3e3e3e"); fgL.addColorStop(1, "#2a2a2a");
  ctx.fillStyle = fgL;
  ctx.fillRect(matX, matY, lEnd - matX, matH);
  // left side face
  ctx.fillStyle = "#303030";
  ctx.beginPath();
  ctx.moveTo(matX,        matY);
  ctx.lineTo(matX + toph, matY - toph);
  ctx.lineTo(matX + toph, matY + matH - toph);
  ctx.lineTo(matX,        matY + matH);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // ── RIGHT PIECE ──
  ctx.save();
  ctx.translate(sep, 0);
  // top face
  const tgR = ctx.createLinearGradient(rSt, matY - toph, matX + matW, matY);
  tgR.addColorStop(0, "#4a4a4a"); tgR.addColorStop(1, "#3e3e3e");
  ctx.fillStyle = tgR;
  ctx.beginPath();
  ctx.moveTo(rSt,             matY);
  ctx.lineTo(rSt + toph,      matY - toph);
  ctx.lineTo(matX + matW + toph, matY - toph);
  ctx.lineTo(matX + matW,     matY);
  ctx.closePath(); ctx.fill();
  // front face
  const fgR = ctx.createLinearGradient(0, matY, 0, matY + matH);
  fgR.addColorStop(0, "#484848"); fgR.addColorStop(0.5, "#363636"); fgR.addColorStop(1, "#262626");
  ctx.fillStyle = fgR;
  ctx.fillRect(rSt, matY, matX + matW - rSt, matH);
  // right side face
  ctx.fillStyle = "#282828";
  ctx.beginPath();
  ctx.moveTo(matX + matW,        matY);
  ctx.lineTo(matX + matW + toph, matY - toph);
  ctx.lineTo(matX + matW + toph, matY + matH - toph);
  ctx.lineTo(matX + matW,        matY + matH);
  ctx.closePath(); ctx.fill();
  ctx.restore();

  // ── KERF (vertical slot, deepens from top) ──
  const kerfDepth = Math.min(matH + toph, eased * (matH + toph + 18));
  if (kerfDepth > 1) {
    ctx.fillStyle = "rgba(0,0,0,0.88)";
    ctx.fillRect(cx - kerfW / 2, matY - toph, kerfW, kerfDepth);
    ctx.shadowColor = "#FF8800";
    ctx.shadowBlur = 7;
    ctx.strokeStyle = `rgba(255,160,0,${0.35 + S.heatGlow * 0.5})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - kerfW / 2, matY - toph); ctx.lineTo(cx - kerfW / 2, matY - toph + kerfDepth); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + kerfW / 2, matY - toph); ctx.lineTo(cx + kerfW / 2, matY - toph + kerfDepth); ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // ── GRINDER (descends vertically, body horizontal) ──
  const discR = 28;
  // disc center starts above material top, ends below material bottom
  const discStart = matY - toph - discR - 12;
  const discEnd   = matY + matH + discR + 10;
  const toolY = discStart + eased * (discEnd - discStart);
  const contactY = toolY + discR;

  ctx.save();
  ctx.translate(cx, toolY);

  // Body (vertical, extends upward from disc)
  const bodyGrad = ctx.createLinearGradient(-15, -65, 15, 0);
  bodyGrad.addColorStop(0, "#2a2a2a"); bodyGrad.addColorStop(0.5, "#464646"); bodyGrad.addColorStop(1, "#343434");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath(); ctx.roundRect(-15, -68, 30, 58, 5); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.06)"; ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath(); ctx.moveTo(-11, -65 + i * 9); ctx.lineTo(11, -65 + i * 9); ctx.stroke();
  }

  // Gear housing
  ctx.fillStyle = "#3a3a3a";
  ctx.beginPath(); ctx.arc(0, 0, 16, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#555"; ctx.lineWidth = 2; ctx.stroke();

  // Side handle (extends right)
  ctx.fillStyle = "#1e1e1e";
  ctx.beginPath(); ctx.roundRect(18, -48, 32, 13, 5); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.moveTo(21 + i * 6, -47); ctx.lineTo(21 + i * 6, -36); ctx.stroke();
  }

  // Spinning disc
  ctx.save();
  ctx.rotate(S.toolAngle);
  const dg = ctx.createRadialGradient(0, 0, 2, 0, 0, discR);
  dg.addColorStop(0, "#999"); dg.addColorStop(0.4, "#666"); dg.addColorStop(0.85, "#555"); dg.addColorStop(1, "#444");
  ctx.fillStyle = dg;
  ctx.beginPath(); ctx.arc(0, 0, discR, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 0.7;
  for (let ri = 0; ri < 10; ri++) {
    const a = (ri / 10) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(Math.cos(a) * 5, Math.sin(a) * 5); ctx.lineTo(Math.cos(a) * discR, Math.sin(a) * discR); ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,200,80,0.3)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, 0, discR - 1, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#888"; ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Heat glow at cutting contact
  const inMat = contactY >= matY - toph - 4 && contactY <= matY + matH + 4;
  if (S.heatGlow > 0.1 && inMat) {
    const gr = 16 + S.heatGlow * 22;
    const glow = ctx.createRadialGradient(0, discR - 3, 0, 0, discR - 3, gr);
    glow.addColorStop(0, `rgba(255,200,0,${S.heatGlow * 0.7})`);
    glow.addColorStop(0.4, `rgba(255,100,0,${S.heatGlow * 0.35})`);
    glow.addColorStop(1, "rgba(255,50,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, discR - 3, gr, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Sparks spray left + right from contact
  if (phase > 0.02 && phase < 0.98 && inMat) {
    spawnSparks(cx - 4, contactY, 2 + Math.floor(S.heatGlow * 3), S.heatGlow > 0.5, -0.9, 0.6);
    spawnSparks(cx + 4, contactY, 2 + Math.floor(S.heatGlow * 3), S.heatGlow > 0.5,  0.9, 0.6);
  }

  // ─── Progress bar (left side) ───
  const barX = W * 0.06;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath(); ctx.roundRect(barX, matY, 6, matH, 3); ctx.fill();
  ctx.fillStyle = "#FFD600";
  ctx.beginPath(); ctx.roundRect(barX, matY, 6, matH * eased, 3); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.font = "9px system-ui"; ctx.textAlign = "center";
  ctx.fillText(`${Math.round(eased * 100)}%`, barX + 3, matY + matH + 14);
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
