"use client";

import { useState, useRef, useEffect } from "react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function AiSupportChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    try {
      const res = await fetch("/api/ai/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMessage,
          history: messages,
        }),
      });

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response || data.error || "Помилка" },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Помилка з'єднання з AI" },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border rounded-xl overflow-hidden" style={{ height: "500px" }}>
      <div className="bg-gradient-to-r from-orange-600 to-orange-500 text-white px-6 py-4">
        <h3 className="font-bold">AI Підтримка</h3>
        <p className="text-sm opacity-80">Запитайте про замовлення, доставку або гарантію</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ height: "calc(100% - 130px)" }}>
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-8">
            <p className="mb-4">Чим можу допомогти?</p>
            <div className="space-y-2">
              {[
                "Де моє замовлення?",
                "Які умови гарантії?",
                "Як повернути товар?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => { setInput(q); }}
                  className="block w-full text-left px-3 py-2 bg-gray-50 rounded-lg hover:bg-orange-50 text-gray-600 text-xs transition"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] px-4 py-2 rounded-xl text-sm ${
              msg.role === "user"
                ? "bg-orange-600 text-white rounded-br-sm"
                : "bg-gray-100 text-gray-800 rounded-bl-sm"
            }`}>
              <div className="whitespace-pre-wrap" dangerouslySetInnerHTML={{
                __html: msg.content
                  .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                  .replace(/\n/g, "<br/>")
              }} />
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 px-4 py-3 rounded-xl">
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

      <div className="border-t p-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            placeholder="Ваше питання..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500"
            disabled={loading}
          />
          <button
            onClick={sendMessage}
            disabled={loading || !input.trim()}
            className="bg-orange-600 text-white px-4 py-2 rounded-lg hover:bg-orange-500 disabled:opacity-50 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
