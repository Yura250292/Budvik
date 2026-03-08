"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import VikingMascot from "./VikingMascot";

// --- Game item definitions ---

interface ItemDef {
  emoji: string;
  name: string;
  points: number;
  message?: string;
}

const GOOD_ITEMS: ItemDef[] = [
  { emoji: "🔨", name: "Молоток", points: 10 },
  { emoji: "🔧", name: "Ключ", points: 10 },
  { emoji: "🪛", name: "Викрутка", points: 10 },
  { emoji: "⚡", name: "Дриль", points: 15 },
  { emoji: "🪚", name: "Пилка", points: 15 },
  { emoji: "🔩", name: "Болт", points: 5 },
  { emoji: "⛏️", name: "Кирка", points: 15 },
  { emoji: "🪓", name: "Сокира", points: 20 },
];

const BAD_ITEMS: ItemDef[] = [
  { emoji: "🧦", name: "Шкарпетка", points: -10, message: "Фу! Це ж шкарпетка!" },
  { emoji: "🥒", name: "Огірок", points: -5, message: "Це не інструмент, це закуска!" },
  { emoji: "🐟", name: "Риба", points: -5, message: "Вікінг ловить рибу, але не тут!" },
  { emoji: "🧸", name: "Ведмедик", points: -10, message: "Це для дітей, а ти — Вікінг!" },
  { emoji: "🩴", name: "Шльопанець", points: -5, message: "В шльопанцях на будівництво?!" },
  { emoji: "🌭", name: "Хот-дог", points: -5, message: "Перерва на обід? Ще рано!" },
  { emoji: "🎸", name: "Гітара", points: -5, message: "Тут будівництво, а не концерт!" },
  { emoji: "🦆", name: "Качка", points: -10, message: "Кря! Не той тип качки..." },
];

const GOOD_MESSAGES = [
  "Гарний улов, Вікінгу!",
  "Тор би позаздрив!",
  "Майстер на всі руки!",
  "Це точно в господарстві знадобиться!",
  "О, класна штука! Берем!",
  "Вікінг знає толк в інструментах!",
  "Один Одін — один улов!",
];

const COMBO_MESSAGES = [
  "КОМБО! Вікінг у ражі! 🔥",
  "Не зупиняйся, воїне!",
  "Ти — машина для ловлі інструментів!",
  "Вальгалла чекає на такого майстра!",
];

function getRank(score: number): { title: string; emoji: string } {
  if (score >= 100) return { title: "Великий Вікінг — Одін пишається тобою!", emoji: "👑" };
  if (score >= 50) return { title: "Майстер молотка — непогано!", emoji: "🔨" };
  if (score >= 20) return { title: "Підмайстер — вже щось вмієш!", emoji: "🪛" };
  return { title: "Учень Вікінга — ще вчитись і вчитись!", emoji: "📚" };
}

// --- Falling item type ---

interface FallingItem {
  id: number;
  def: ItemDef;
  isGood: boolean;
  x: number; // % from left
  y: number; // px from top
  speed: number;
  caught: boolean;
  size: number;
}

// --- Component ---

interface VikingToolCatchGameProps {
  isLoading: boolean;
}

export default function VikingToolCatchGame({ isLoading }: VikingToolCatchGameProps) {
  const [items, setItems] = useState<FallingItem[]>([]);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"good" | "bad" | "combo">("good");
  const [gameOver, setGameOver] = useState(false);
  const [mascotVariant, setMascotVariant] = useState<"default" | "wink" | "thinking">("thinking");

  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const lastSpawnRef = useRef(0);
  const nextIdRef = useRef(0);
  const itemsRef = useRef<FallingItem[]>([]);
  const isLoadingRef = useRef(isLoading);
  const lastFrameRef = useRef(0);
  const messageTimerRef = useRef<NodeJS.Timeout>(null);

  const CONTAINER_HEIGHT = 320;
  const SPAWN_INTERVAL_MIN = 700;
  const SPAWN_INTERVAL_MAX = 1200;
  const MAX_ITEMS = 10;

  // Keep ref in sync
  useEffect(() => {
    isLoadingRef.current = isLoading;
    if (!isLoading) {
      setGameOver(true);
      cancelAnimationFrame(animFrameRef.current);
    }
  }, [isLoading]);

  const showMessage = useCallback((text: string, type: "good" | "bad" | "combo") => {
    setMessage(text);
    setMessageType(type);
    if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    messageTimerRef.current = setTimeout(() => setMessage(null), 1200);
  }, []);

  const handleCatch = useCallback((item: FallingItem) => {
    // Mark as caught
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, caught: true } : i));
    itemsRef.current = itemsRef.current.map(i => i.id === item.id ? { ...i, caught: true } : i);

    if (item.isGood) {
      setScore(prev => prev + item.def.points);
      setCombo(prev => {
        const newCombo = prev + 1;
        if (newCombo >= 3) {
          showMessage(COMBO_MESSAGES[Math.floor(Math.random() * COMBO_MESSAGES.length)], "combo");
          setMascotVariant("wink");
        } else {
          showMessage(GOOD_MESSAGES[Math.floor(Math.random() * GOOD_MESSAGES.length)], "good");
          setMascotVariant("wink");
        }
        setTimeout(() => setMascotVariant("default"), 800);
        return newCombo;
      });
    } else {
      setScore(prev => Math.max(0, prev + item.def.points));
      setCombo(0);
      showMessage(item.def.message || "Це не інструмент!", "bad");
      setMascotVariant("thinking");
      setTimeout(() => setMascotVariant("default"), 800);
    }
  }, [showMessage]);

  // Game loop
  useEffect(() => {
    const spawnItem = (now: number) => {
      if (itemsRef.current.filter(i => !i.caught).length >= MAX_ITEMS) return;

      const isGood = Math.random() < 0.7;
      const pool = isGood ? GOOD_ITEMS : BAD_ITEMS;
      const def = pool[Math.floor(Math.random() * pool.length)];

      const newItem: FallingItem = {
        id: nextIdRef.current++,
        def,
        isGood,
        x: 5 + Math.random() * 80, // 5% to 85%
        y: -40,
        speed: 1.2 + Math.random() * 1.3,
        caught: false,
        size: 32 + Math.random() * 12,
      };

      itemsRef.current = [...itemsRef.current, newItem];
      lastSpawnRef.current = now;
    };

    let spawnInterval = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);

    const loop = (timestamp: number) => {
      if (!isLoadingRef.current) return;

      const delta = lastFrameRef.current ? timestamp - lastFrameRef.current : 16;
      lastFrameRef.current = timestamp;

      // Spawn new items
      if (timestamp - lastSpawnRef.current > spawnInterval) {
        spawnItem(timestamp);
        spawnInterval = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
      }

      // Move items
      const multiplier = delta / 16; // normalize to ~60fps
      itemsRef.current = itemsRef.current
        .map(item => ({
          ...item,
          y: item.caught ? item.y : item.y + item.speed * multiplier,
        }))
        .filter(item => item.y < CONTAINER_HEIGHT + 50 && !item.caught);

      setItems([...itemsRef.current]);
      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      <div className="max-w-md mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-gray-900">⭐ {score}</span>
            {combo >= 3 && (
              <span className="text-xs font-bold text-yellow-600 bg-yellow-100 px-2 py-0.5 rounded-full animate-pulse">
                x{combo} КОМБО!
              </span>
            )}
          </div>
          <span className="text-xs text-gray-400">Лови інструменти!</span>
        </div>

        {/* Game area */}
        <div
          ref={containerRef}
          className="relative bg-gradient-to-b from-gray-100 to-gray-50 border border-gray-200 rounded-2xl overflow-hidden select-none"
          style={{ height: CONTAINER_HEIGHT, touchAction: "manipulation" }}
        >
          {/* Falling items */}
          {items.map(item => (
            <button
              key={item.id}
              onClick={() => handleCatch(item)}
              className="absolute transition-transform duration-75 hover:scale-125 active:scale-90 cursor-pointer focus:outline-none"
              style={{
                left: `${item.x}%`,
                top: item.y,
                fontSize: item.size,
                lineHeight: 1,
                touchAction: "manipulation",
                zIndex: 10,
                filter: item.isGood ? "none" : "saturate(0.7)",
              }}
              aria-label={item.def.name}
            >
              {item.def.emoji}
            </button>
          ))}

          {/* Message popup */}
          {message && (
            <div
              className={`absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-2 rounded-xl text-sm font-bold shadow-lg z-20 animate-bounce-in whitespace-nowrap ${
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

          {/* Viking mascot at bottom */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-5">
            <VikingMascot size={48} variant={mascotVariant} animated />
          </div>

          {/* Bottom hint */}
          <div className="absolute bottom-1 left-0 right-0 text-center">
            <span className="text-[10px] text-gray-400">
              AI підбирає інструменти для тебе...
            </span>
          </div>
        </div>

        {/* Instructions */}
        <p className="text-xs text-gray-400 text-center mt-2">
          Тапай на інструменти 🔧 — бонус! На сміття 🧦 — штраф!
        </p>
      </div>
    </div>
  );
}
