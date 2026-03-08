"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import VikingMascot from "./VikingMascot";

// --- Items that SHOULD be cut (metal, construction materials) ---

interface ItemDef {
  emoji: string;
  name: string;
  points: number;
  cutMessage?: string;
}

const CUT_ITEMS: ItemDef[] = [
  { emoji: "🔩", name: "Болт", points: 10, cutMessage: "Болт розрізано! Як масло!" },
  { emoji: "⛓️", name: "Ланцюг", points: 15, cutMessage: "Ланцюг — не проблема!" },
  { emoji: "🪨", name: "Камінь", points: 10, cutMessage: "Навіть камінь піддався!" },
  { emoji: "🧱", name: "Цегла", points: 15, cutMessage: "Рівний розріз!" },
  { emoji: "🪵", name: "Дошка", points: 10, cutMessage: "Дерево тріщить від страху!" },
  { emoji: "🔗", name: "Замок", points: 20, cutMessage: "Замок? Який замок?" },
  { emoji: "🛡️", name: "Щит", points: 20, cutMessage: "Навіть щит вікінга!" },
  { emoji: "⚙️", name: "Шестерня", points: 15, cutMessage: "Механізм розібрано!" },
];

// --- Items that should NOT be cut ---

const NO_CUT_ITEMS: ItemDef[] = [
  { emoji: "🐱", name: "Котик", points: -15, cutMessage: "НІ! Котика не чіпай! 😿" },
  { emoji: "🌵", name: "Кактус", points: -10, cutMessage: "Ай! Він же колючий!" },
  { emoji: "📱", name: "Телефон", points: -10, cutMessage: "Це ж новий iPhone! 😱" },
  { emoji: "💎", name: "Діамант", points: -15, cutMessage: "Діамант дорожче болгарки!" },
  { emoji: "🎂", name: "Торт", points: -10, cutMessage: "Торт ріжуть ножем, дикуне!" },
  { emoji: "👔", name: "Краватка шефа", points: -20, cutMessage: "Це ж краватка шефа! Звільнений!" },
  { emoji: "🧸", name: "Ведмедик", points: -10, cutMessage: "За що йому таке?! 😢" },
  { emoji: "🎸", name: "Гітара", points: -10, cutMessage: "Мистецтво не ріжуть!" },
  { emoji: "🍉", name: "Кавун", points: -5, cutMessage: "Для кавуна є ніж! 🍉" },
  { emoji: "👟", name: "Кросівка", points: -10, cutMessage: "Найки за 5000 грн?!" },
];

const COMBO_MESSAGES = [
  "КОМБО! Болгарка розігрілась! 🔥",
  "Не зупиняйся, майстре!",
  "Різак-машина!",
  "Іскри летять — робота кипить!",
];

function getRank(score: number): { title: string; emoji: string } {
  if (score >= 120) return { title: "Бог Болгарки — метал тремтить!", emoji: "👑" };
  if (score >= 70) return { title: "Майстер різки — рівні зрізи!", emoji: "⚡" };
  if (score >= 30) return { title: "Підмайстер — вже не страшно!", emoji: "🪛" };
  return { title: "Учень — тримай болгарку рівніше!", emoji: "📚" };
}

// --- Spark particle for cut effect ---

interface Spark {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

// --- Falling item ---

interface FallingItem {
  id: number;
  def: ItemDef;
  shouldCut: boolean;
  x: number; // px from left
  y: number; // px from top
  speed: number;
  cut: boolean;
  splitDir?: number; // -1 left, 1 right — for cut animation
}

// --- Constants ---

const CONTAINER_WIDTH = 380;
const CONTAINER_HEIGHT = 360;
const GRINDER_WIDTH = 56;
const GRINDER_Y = CONTAINER_HEIGHT - 60;
const ITEM_SIZE = 36;
const SPAWN_MIN = 800;
const SPAWN_MAX = 1400;
const MAX_ITEMS = 8;

// --- Component ---

interface VikingToolCatchGameProps {
  isLoading: boolean;
}

export default function VikingToolCatchGame({ isLoading }: VikingToolCatchGameProps) {
  const [grinderX, setGrinderX] = useState(CONTAINER_WIDTH / 2);
  const [items, setItems] = useState<FallingItem[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"good" | "bad" | "combo">("good");
  const [gameOver, setGameOver] = useState(false);
  const [mascotVariant, setMascotVariant] = useState<"default" | "wink" | "thinking">("thinking");
  const [cutting, setCutting] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef(0);
  const lastSpawnRef = useRef(0);
  const nextIdRef = useRef(0);
  const sparkIdRef = useRef(0);
  const itemsRef = useRef<FallingItem[]>([]);
  const sparksRef = useRef<Spark[]>([]);
  const isLoadingRef = useRef(isLoading);
  const lastFrameRef = useRef(0);
  const messageTimerRef = useRef<NodeJS.Timeout>(null);
  const grinderXRef = useRef(grinderX);
  const scoreRef = useRef(0);
  const comboRef = useRef(0);
  const cuttingTimerRef = useRef<NodeJS.Timeout>(null);
  const containerWidthRef = useRef(CONTAINER_WIDTH);

  // Sync refs
  useEffect(() => { grinderXRef.current = grinderX; }, [grinderX]);
  useEffect(() => {
    isLoadingRef.current = isLoading;
    if (!isLoading) {
      setGameOver(true);
      cancelAnimationFrame(animFrameRef.current);
    }
  }, [isLoading]);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      containerWidthRef.current = el.clientWidth;
      setGrinderX(el.clientWidth / 2);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Show message
  const showMessage = useCallback((text: string, type: "good" | "bad" | "combo") => {
    setMessage(text);
    setMessageType(type);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), 1400);
  }, []);

  // Spawn sparks
  const spawnSparks = useCallback((x: number, y: number) => {
    const newSparks: Spark[] = [];
    for (let i = 0; i < 8; i++) {
      newSparks.push({
        id: sparkIdRef.current++,
        x, y,
        vx: (Math.random() - 0.5) * 8,
        vy: -Math.random() * 6 - 2,
        life: 1,
      });
    }
    sparksRef.current = [...sparksRef.current, ...newSparks];
  }, []);

  // Handle cut collision
  const handleCut = useCallback((item: FallingItem) => {
    // Mark as cut
    const dir = item.x < grinderXRef.current ? -1 : 1;
    itemsRef.current = itemsRef.current.map(i =>
      i.id === item.id ? { ...i, cut: true, splitDir: dir } : i
    );

    // Spark effect
    spawnSparks(item.x, item.y);
    setCutting(true);
    if (cuttingTimerRef.current) clearTimeout(cuttingTimerRef.current);
    cuttingTimerRef.current = setTimeout(() => setCutting(false), 200);

    if (item.shouldCut) {
      const newCombo = comboRef.current + 1;
      comboRef.current = newCombo;
      setCombo(newCombo);

      const pts = item.def.points * (newCombo >= 3 ? 2 : 1);
      scoreRef.current = scoreRef.current + pts;
      setScore(scoreRef.current);

      if (newCombo >= 3 && newCombo % 3 === 0) {
        showMessage(COMBO_MESSAGES[Math.floor(Math.random() * COMBO_MESSAGES.length)], "combo");
      } else {
        showMessage(item.def.cutMessage || "Розрізано!", "good");
      }
      setMascotVariant("wink");
      setTimeout(() => setMascotVariant("default"), 600);
    } else {
      comboRef.current = 0;
      setCombo(0);
      scoreRef.current = Math.max(0, scoreRef.current + item.def.points);
      setScore(scoreRef.current);
      showMessage(item.def.cutMessage || "Не те!", "bad");
      setMascotVariant("thinking");
      setTimeout(() => setMascotVariant("default"), 600);
    }
  }, [showMessage, spawnSparks]);

  // Keyboard controls
  useEffect(() => {
    const step = 18;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") {
        setGrinderX(prev => Math.max(GRINDER_WIDTH / 2, prev - step));
      } else if (e.key === "ArrowRight" || e.key === "d") {
        setGrinderX(prev => Math.min(containerWidthRef.current - GRINDER_WIDTH / 2, prev + step));
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  // Touch / mouse drag
  const dragging = useRef(false);
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = true;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      setGrinderX(Math.max(GRINDER_WIDTH / 2, Math.min(containerWidthRef.current - GRINDER_WIDTH / 2, x)));
    }
  }, []);
  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left;
      setGrinderX(Math.max(GRINDER_WIDTH / 2, Math.min(containerWidthRef.current - GRINDER_WIDTH / 2, x)));
    }
  }, []);
  const handlePointerUp = useCallback(() => { dragging.current = false; }, []);

  // Game loop
  useEffect(() => {
    let spawnInterval = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);

    const spawnItem = (now: number) => {
      if (itemsRef.current.filter(i => !i.cut).length >= MAX_ITEMS) return;

      const shouldCut = Math.random() < 0.6;
      const pool = shouldCut ? CUT_ITEMS : NO_CUT_ITEMS;
      const def = pool[Math.floor(Math.random() * pool.length)];

      const newItem: FallingItem = {
        id: nextIdRef.current++,
        def,
        shouldCut,
        x: ITEM_SIZE + Math.random() * (containerWidthRef.current - ITEM_SIZE * 2),
        y: -ITEM_SIZE,
        speed: 1.0 + Math.random() * 1.0,
        cut: false,
      };

      itemsRef.current = [...itemsRef.current, newItem];
      lastSpawnRef.current = now;
    };

    const loop = (timestamp: number) => {
      if (!isLoadingRef.current) return;

      const delta = lastFrameRef.current ? timestamp - lastFrameRef.current : 16;
      lastFrameRef.current = timestamp;
      const mult = delta / 16;

      // Spawn
      if (timestamp - lastSpawnRef.current > spawnInterval) {
        spawnItem(timestamp);
        spawnInterval = SPAWN_MIN + Math.random() * (SPAWN_MAX - SPAWN_MIN);
      }

      // Move items & check collision
      const gx = grinderXRef.current;
      const cutZoneTop = GRINDER_Y - 10;
      const cutZoneBottom = GRINDER_Y + 20;
      const cutZoneHalf = GRINDER_WIDTH / 2 + 8;

      itemsRef.current = itemsRef.current
        .map(item => {
          if (item.cut) return item;
          const newY = item.y + item.speed * mult;

          // Check collision with grinder
          if (
            newY >= cutZoneTop && newY <= cutZoneBottom &&
            Math.abs(item.x - gx) < cutZoneHalf
          ) {
            // Will be handled by handleCut
            return { ...item, y: newY, cut: true };
          }

          return { ...item, y: newY };
        })
        .filter(item => item.y < CONTAINER_HEIGHT + 60);

      // Process newly cut items
      itemsRef.current.forEach(item => {
        if (item.cut && item.splitDir === undefined) {
          handleCut(item);
        }
      });

      // Update sparks
      sparksRef.current = sparksRef.current
        .map(s => ({
          ...s,
          x: s.x + s.vx * mult,
          y: s.y + s.vy * mult,
          vy: s.vy + 0.3 * mult,
          life: s.life - 0.03 * mult,
        }))
        .filter(s => s.life > 0);

      setItems([...itemsRef.current]);
      setSparks([...sparksRef.current]);
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
      if (cuttingTimerRef.current) clearTimeout(cuttingTimerRef.current);
    };
  }, [handleCut]);

  // Game over screen
  if (gameOver) {
    const rank = getRank(score);
    return (
      <div className="mt-8 text-center animate-fade-in">
        <div className="max-w-md mx-auto bg-gradient-to-b from-gray-50 to-white border border-gray-200 rounded-2xl p-6 shadow-lg">
          <VikingMascot size={64} variant="wink" animated className="mx-auto mb-3" />
          <p className="text-2xl font-bold text-gray-900 mb-1">{rank.emoji} {score} очок!</p>
          <p className="text-sm text-gray-600 mb-4">{rank.title}</p>
          <div className="flex items-center justify-center gap-2 text-sm text-gray-400">
            <div className="animate-spin w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full" />
            AI вже майже підібрав інструменти...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-8">
      <div className="max-w-[400px] mx-auto">
        {/* Score bar */}
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-gray-900">⚡ {score}</span>
            {combo >= 3 && (
              <span className="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full animate-pulse">
                x{combo} КОМБО!
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <VikingMascot size={24} variant={mascotVariant} />
            <span className="text-xs text-gray-400">Ріж метал!</span>
          </div>
        </div>

        {/* Game area */}
        <div
          ref={containerRef}
          className="relative bg-gradient-to-b from-slate-100 via-slate-50 to-amber-50 border border-gray-200 rounded-2xl overflow-hidden select-none cursor-none"
          style={{ height: CONTAINER_HEIGHT, touchAction: "none" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Lane guides */}
          <div className="absolute inset-0 opacity-[0.03]" style={{
            backgroundImage: "repeating-linear-gradient(90deg, transparent, transparent 25%, #000 25%, #000 25.5%)",
          }} />

          {/* Falling items */}
          {items.map(item => (
            <div
              key={item.id}
              className="absolute transition-none"
              style={{
                left: item.x - ITEM_SIZE / 2,
                top: item.y,
                fontSize: ITEM_SIZE,
                lineHeight: 1,
                zIndex: 10,
                opacity: item.cut ? 0 : 1,
                transition: item.cut ? "opacity 0.15s" : "none",
                // Visual hint: green glow for cuttable, red tint for not
                filter: item.shouldCut
                  ? "drop-shadow(0 0 3px rgba(34,197,94,0.4))"
                  : "drop-shadow(0 0 3px rgba(239,68,68,0.3))",
              }}
            >
              {item.def.emoji}
              {/* Small label */}
              {item.y > 10 && item.y < CONTAINER_HEIGHT - 80 && (
                <span
                  className={`absolute -bottom-4 left-1/2 -translate-x-1/2 text-[9px] font-bold whitespace-nowrap px-1 rounded ${
                    item.shouldCut ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {item.shouldCut ? "✂️ ріж!" : "⛔"}
                </span>
              )}
            </div>
          ))}

          {/* Cut halves animation */}
          {items.filter(i => i.cut && i.splitDir !== undefined).map(item => (
            <div key={`cut-${item.id}`} className="absolute" style={{
              left: item.x - ITEM_SIZE / 2,
              top: item.y,
              fontSize: ITEM_SIZE,
              lineHeight: 1,
              zIndex: 11,
            }}>
              {/* Left half */}
              <span style={{
                display: "inline-block",
                clipPath: "inset(0 50% 0 0)",
                animation: "cut-left 0.4s ease-out forwards",
              }}>
                {item.def.emoji}
              </span>
              {/* Right half */}
              <span style={{
                display: "inline-block",
                clipPath: "inset(0 0 0 50%)",
                position: "absolute",
                left: 0,
                top: 0,
                animation: "cut-right 0.4s ease-out forwards",
              }}>
                {item.def.emoji}
              </span>
            </div>
          ))}

          {/* Sparks */}
          {sparks.map(spark => (
            <div
              key={spark.id}
              className="absolute rounded-full pointer-events-none"
              style={{
                left: spark.x,
                top: spark.y,
                width: 4,
                height: 4,
                background: `radial-gradient(circle, #FFD600, #FF8C00)`,
                opacity: spark.life,
                zIndex: 30,
                boxShadow: "0 0 6px 2px rgba(255,214,0,0.6)",
              }}
            />
          ))}

          {/* Grinder (болгарка) */}
          <div
            className="absolute z-20 transition-none"
            style={{
              left: grinderX - GRINDER_WIDTH / 2,
              top: GRINDER_Y - 10,
            }}
          >
            {/* Grinder body */}
            <div className="relative" style={{ width: GRINDER_WIDTH, height: 44 }}>
              {/* Disc */}
              <div
                className="absolute rounded-full border-2 border-gray-600"
                style={{
                  width: 40,
                  height: 40,
                  left: 8,
                  top: 2,
                  background: cutting
                    ? "conic-gradient(from 0deg, #FFD600, #FF6B00, #FFD600, #FF6B00, #FFD600)"
                    : "conic-gradient(from 0deg, #9CA3AF, #6B7280, #9CA3AF, #6B7280, #9CA3AF)",
                  animation: "spin-disc 0.15s linear infinite",
                  boxShadow: cutting ? "0 0 12px rgba(255,214,0,0.8)" : "none",
                }}
              />
              {/* Handle */}
              <div
                className="absolute bg-gray-700 rounded-md"
                style={{
                  width: 24,
                  height: 12,
                  left: 16,
                  top: 36,
                  borderRadius: "0 0 6px 6px",
                }}
              />
              {/* Grip */}
              <div
                className="absolute bg-orange-500 rounded-sm"
                style={{
                  width: 16,
                  height: 8,
                  left: 20,
                  top: 42,
                  borderRadius: "0 0 4px 4px",
                }}
              />
            </div>
          </div>

          {/* Cutting line indicator */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: grinderX - 1,
              top: 0,
              width: 2,
              height: GRINDER_Y,
              background: "linear-gradient(to bottom, transparent 60%, rgba(255,214,0,0.15) 100%)",
              zIndex: 5,
            }}
          />

          {/* Message popup */}
          {message && (
            <div
              className={`absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-xl text-sm font-bold shadow-lg z-40 animate-bounce-in whitespace-nowrap ${
                messageType === "combo"
                  ? "bg-yellow-400 text-black"
                  : messageType === "good"
                  ? "bg-green-100 text-green-800 border border-green-200"
                  : "bg-red-100 text-red-800 border border-red-200"
              }`}
            >
              {message}
            </div>
          )}

          {/* Floor */}
          <div className="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-amber-100 to-transparent" />
        </div>

        {/* Instructions */}
        <div className="flex items-center justify-center gap-3 mt-2">
          <span className="text-[11px] text-gray-400">
            ← → або тягни пальцем
          </span>
          <span className="text-[11px] text-gray-300">|</span>
          <span className="text-[11px] text-gray-400">
            <span className="text-green-500">✂️ ріж!</span> = бонус, <span className="text-red-400">⛔</span> = штраф
          </span>
        </div>
        <p className="text-[10px] text-gray-300 text-center mt-1">
          AI підбирає найкращі інструменти для тебе...
        </p>
      </div>
    </div>
  );
}
