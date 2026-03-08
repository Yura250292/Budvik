"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import AiMarkdown from "./AiMarkdown";
import { formatPrice } from "@/lib/utils";

interface AIProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  image: string | null;
  stock: number;
  isPromo: boolean;
  promoPrice: number | null;
  promoLabel: string | null;
  category: { name: string; slug: string };
}

interface Message {
  role: "user" | "assistant";
  content: string;
  products?: AIProduct[];
}

function ProductCard({ product }: { product: AIProduct }) {
  return (
    <Link
      href={`/catalog/${product.slug}`}
      className="flex gap-3 bg-white border border-gray-200 rounded-lg p-2.5 hover:border-yellow-400 hover:shadow-sm transition group"
    >
      <div className="w-14 h-14 bg-gray-100 rounded flex-shrink-0 overflow-hidden">
        {product.image ? (
          <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <h5 className="text-xs font-medium text-gray-900 line-clamp-2 group-hover:text-yellow-700 transition">
          {product.name}
        </h5>
        <div className="flex items-center gap-2 mt-1">
          {product.isPromo && product.promoPrice ? (
            <>
              <span className="text-xs font-bold text-red-600">{formatPrice(product.promoPrice)}</span>
              <span className="text-[10px] text-gray-400 line-through">{formatPrice(product.price)}</span>
            </>
          ) : (
            <span className="text-xs font-bold text-gray-900">{formatPrice(product.price)}</span>
          )}
        </div>
        <span className={`text-[10px] ${product.stock > 0 ? "text-green-600" : "text-red-500"}`}>
          {product.stock > 0 ? `В наявності: ${product.stock} шт` : "Немає в наявності"}
        </span>
      </div>
      <div className="flex items-center flex-shrink-0">
        <span className="text-yellow-500 group-hover:text-yellow-600 transition">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

function ComparisonTable({ products }: { products: AIProduct[] }) {
  return (
    <div className="overflow-x-auto my-2 -mx-1">
      <table className="w-full text-[10px] border-collapse border border-gray-200 rounded">
        <thead>
          <tr className="bg-yellow-50">
            <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-600">Параметр</th>
            {products.map((p) => (
              <th key={p.id} className="border border-gray-200 px-2 py-1.5 text-left font-semibold text-gray-700">
                {p.name.length > 25 ? p.name.slice(0, 25) + "..." : p.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-600">Фото</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-2 py-1">
                {p.image ? (
                  <img src={p.image} alt={p.name} className="w-12 h-12 object-cover rounded" />
                ) : (
                  <div className="w-12 h-12 bg-gray-100 rounded flex items-center justify-center text-gray-300 text-[8px]">Фото</div>
                )}
              </td>
            ))}
          </tr>
          <tr className="bg-gray-50">
            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-600">Ціна</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-2 py-1 font-bold text-gray-900">
                {p.isPromo && p.promoPrice ? (
                  <span className="text-red-600">{formatPrice(p.promoPrice)}</span>
                ) : (
                  formatPrice(p.price)
                )}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-600">Категорія</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-2 py-1">{p.category.name}</td>
            ))}
          </tr>
          <tr className="bg-gray-50">
            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-600">Наявність</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-2 py-1">
                {p.stock > 0 ? (
                  <span className="text-green-600">{p.stock} шт</span>
                ) : (
                  <span className="text-red-500">Немає</span>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-gray-200 px-2 py-1 font-medium text-gray-600">Посилання</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-2 py-1">
                <Link href={`/catalog/${p.slug}`} className="text-yellow-600 hover:underline font-medium">
                  Перейти
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function AiChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [compareProducts, setCompareProducts] = useState<AIProduct[] | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, compareProducts]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);
    setCompareProducts(null);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response || data.error || "Помилка",
          products: data.products || [],
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Помилка з'єднання з AI сервісом" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-24 md:bottom-6 right-4 z-50 bg-black hover:bg-gray-900 text-yellow-400 w-14 h-14 rounded-full shadow-lg border border-yellow-400/30 flex items-center justify-center transition-all"
        aria-label="AI Консультант"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed z-50 bg-white shadow-2xl border border-[#EFEFEF] flex flex-col inset-0 md:inset-auto md:bottom-22 md:right-4 md:w-[440px] md:rounded-xl md:max-w-[calc(100vw-2rem)] h-full md:h-[600px]">
          {/* Header */}
          <div className="bg-gradient-to-r from-[#0A0A0A] to-[#1A1A1A] text-white px-4 py-3 md:rounded-t-xl flex items-center gap-3 safe-area-top">
            <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-sm">AI Консультант BUDVIK</h3>
              <p className="text-xs opacity-80">Допоможу обрати інструмент</p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="md:hidden w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/20 transition"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center text-gray-400 text-sm mt-8">
                <p className="mb-4">Запитайте мене про інструменти!</p>
                <div className="space-y-2">
                  {[
                    "Потрібен дриль для дому",
                    "Підбери болгарку",
                    "Що краще: Bosch чи Makita?",
                    "Шуруповерт акумуляторний до 3000 грн",
                    "Який інструмент для різки плитки?",
                  ].map((q) => (
                    <button
                      key={q}
                      onClick={() => {
                        setInput(q);
                        setTimeout(() => sendMessage(), 0);
                      }}
                      className="block w-full text-left px-3 py-2 bg-gray-50 rounded-lg hover:bg-yellow-50 text-gray-600 text-xs transition"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i}>
                <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
                      msg.role === "user"
                        ? "bg-black text-white rounded-br-sm"
                        : "bg-gray-100 text-gray-800 rounded-bl-sm"
                    }`}
                  >
                    <AiMarkdown content={msg.content} isUser={msg.role === "user"} />
                  </div>
                </div>

                {/* Product cards for assistant messages */}
                {msg.role === "assistant" && msg.products && msg.products.length > 0 && (
                  <div className="mt-2 space-y-1.5 ml-0 max-w-[95%]">
                    <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">Рекомендовані товари:</p>
                    {msg.products.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}

                    {/* Compare button for 2+ products */}
                    {msg.products.length >= 2 && (
                      <button
                        onClick={() => setCompareProducts(
                          compareProducts && compareProducts[0]?.id === msg.products![0]?.id
                            ? null
                            : msg.products!
                        )}
                        className="w-full text-center text-xs text-yellow-700 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-lg py-1.5 font-medium transition mt-1"
                      >
                        {compareProducts && compareProducts[0]?.id === msg.products[0]?.id
                          ? "Сховати порівняння"
                          : `Порівняти ${msg.products.length} товари`}
                      </button>
                    )}

                    {/* Comparison table */}
                    {compareProducts && compareProducts[0]?.id === msg.products[0]?.id && (
                      <ComparisonTable products={compareProducts} />
                    )}
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 px-4 py-3 rounded-xl rounded-bl-sm">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Напишіть запитання..."
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-yellow-500"
                disabled={loading}
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="bg-yellow-400 text-black px-3 py-2 rounded-lg hover:bg-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
