"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";

export default function AnalyticsPage() {
  const { data: session } = useSession();
  const [report, setReport] = useState("");
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    fetch("/api/ai/analytics")
      .then((r) => r.json())
      .then((data) => {
        if (data.report) setReport(data.report);
        else setReport(data.error || "Помилка завантаження");
      })
      .catch(() => setReport("Помилка з'єднання"))
      .finally(() => setLoading(false));
  }, []);

  const askQuestion = async () => {
    if (!question.trim() || asking) return;
    setAsking(true);
    setAnswer("");

    try {
      const res = await fetch("/api/ai/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      setAnswer(data.response || data.error || "Помилка");
    } catch {
      setAnswer("Помилка з'єднання");
    } finally {
      setAsking(false);
    }
  };

  if (!session || (session.user as any).role !== "ADMIN") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-bk">Доступ обмежений</h1>
        <p className="text-g400 mt-2">Ця сторінка доступна тільки адміністраторам</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-bk mb-2">AI Аналітика продажів</h1>
      <p className="text-g400 mb-8">Автоматичний аналіз продажів, тренди та рекомендації</p>

      {loading ? (
        <div className="bg-white border rounded-xl p-8 text-center">
          <div className="animate-spin w-10 h-10 border-3 border-orange-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-g400">AI аналізує дані продажів...</p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl p-6 prose prose-sm max-w-none mb-8">
          <div dangerouslySetInnerHTML={{
            __html: report
              .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
              .replace(/\*(.*?)\*/g, "<em>$1</em>")
              .replace(/#{3}\s(.+)/g, "<h3>$1</h3>")
              .replace(/#{2}\s(.+)/g, "<h2>$1</h2>")
              .replace(/\n- /g, "\n<br/>• ")
              .replace(/\n/g, "<br/>")
          }} />
        </div>
      )}

      {/* Ask AI about analytics */}
      <div className="bg-white border rounded-xl p-6">
        <h2 className="text-lg font-bold text-bk mb-4">Запитати AI аналітика</h2>
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && askQuestion()}
            placeholder="Наприклад: Які товари потрібно замовити? Який тренд продажів?"
            className="flex-1 border border-g300 rounded-lg px-4 py-2 focus:outline-none focus:border-orange-500"
          />
          <button
            onClick={askQuestion}
            disabled={asking || !question.trim()}
            className="bg-orange-600 text-white px-6 py-2 rounded-lg hover:bg-orange-500 disabled:opacity-50 font-medium transition"
          >
            {asking ? "..." : "Запитати"}
          </button>
        </div>
        {answer && (
          <div className="bg-g50 rounded-lg p-4 prose prose-sm max-w-none">
            <div dangerouslySetInnerHTML={{
              __html: answer
                .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
                .replace(/\*(.*?)\*/g, "<em>$1</em>")
                .replace(/\n- /g, "\n<br/>• ")
                .replace(/\n/g, "<br/>")
            }} />
          </div>
        )}
      </div>
    </div>
  );
}
