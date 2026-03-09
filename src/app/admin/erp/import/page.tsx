"use client";

import { useSession } from "next-auth/react";
import { useState } from "react";
import Link from "next/link";

type Step = "counterparties" | "documents" | "done";
type ImportResult = { created?: number; updated?: number; imported?: number; skipped?: number; errors?: string[]; total?: number; count?: number; items?: any[] };

export default function ImportPage() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>("counterparties");
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<"purchase" | "sales">("purchase");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [allResults, setAllResults] = useState<{ step: string; result: ImportResult }[]>([]);

  const role = (session?.user as any)?.role;

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const resetForm = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    setPreview(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", "preview");
    if (step === "documents") formData.append("type", docType);

    const url = step === "counterparties" ? "/api/erp/import/counterparties" : "/api/erp/import/documents";
    const res = await fetch(url, { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) {
      setPreview(data);
    } else {
      alert(data.error || "Помилка");
    }
    setLoading(false);
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    if (step === "documents") formData.append("type", docType);

    const url = step === "counterparties" ? "/api/erp/import/counterparties" : "/api/erp/import/documents";
    const res = await fetch(url, { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) {
      setResult(data);
      setAllResults((prev) => [...prev, { step: step === "counterparties" ? "Контрагенти" : docType === "purchase" ? "Закупівлі" : "Продажі", result: data }]);
    } else {
      alert(data.error || "Помилка");
    }
    setLoading(false);
  };

  const goNext = () => {
    if (step === "counterparties") {
      setStep("documents");
    } else {
      setStep("done");
    }
    resetForm();
  };

  const STEPS = [
    { key: "counterparties", label: "1. Контрагенти" },
    { key: "documents", label: "2. Документи" },
    { key: "done", label: "3. Готово" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center gap-3">
          <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
            <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Імпорт з 1С</h1>
            <p style={{ fontSize: "14px", color: "#6B7280" }}>Покроковий імпорт даних</p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {/* Step indicator */}
        <div className="flex gap-2 mb-8">
          {STEPS.map((s) => (
            <div key={s.key} className="flex-1 text-center" style={{
              padding: "12px", borderRadius: "8px", fontSize: "14px", fontWeight: 600,
              background: step === s.key ? "#FFD600" : "white",
              border: `1px solid ${step === s.key ? "#FFD600" : "#E5E7EB"}`,
              color: step === s.key ? "#0A0A0A" : "#9CA3AF",
            }}>
              {s.label}
            </div>
          ))}
        </div>

        {/* Step: Counterparties */}
        {step === "counterparties" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Імпорт контрагентів</h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "20px" }}>
              Завантажте XML (вигрузка з 1С) або CSV файл з контрагентами. Існуючі контрагенти будуть оновлені за кодом.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Файл (XML або CSV)</label>
              <input type="file" accept=".xml,.csv,.txt" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }}
                style={{ fontSize: "14px" }} />
            </div>

            <div className="flex gap-3 mb-6">
              <button onClick={handlePreview} disabled={!file || loading}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: !file || loading ? 0.5 : 1 }}>
                {loading ? "..." : "Попередній перегляд"}
              </button>
              {preview && (
                <button onClick={handleImport} disabled={loading}
                  style={{ background: "#FFD600", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: loading ? 0.5 : 1 }}>
                  {loading ? "Імпортую..." : `Імпортувати (${preview.count})`}
                </button>
              )}
            </div>

            {/* Preview */}
            {preview && !result && (
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Знайдено: {preview.count} контрагентів</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Код</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Назва</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Тип</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Телефон</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items?.map((item, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "6px 8px" }}>{item.code}</td>
                          <td style={{ padding: "6px 8px" }}>{item.name}</td>
                          <td style={{ padding: "6px 8px" }}>{item.type}</td>
                          <td style={{ padding: "6px 8px" }}>{item.phone || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(preview.count || 0) > 50 && <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "8px" }}>Показано перші 50...</p>}
                </div>
              </div>
            )}

            {/* Result */}
            {result && <ResultCard result={result} label="контрагентів" />}

            <div className="flex justify-end mt-4">
              <button onClick={goNext}
                style={{ background: "#FFD600", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                {result ? "Далі: Документи" : "Пропустити"}
              </button>
            </div>
          </div>
        )}

        {/* Step: Documents */}
        {step === "documents" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Імпорт документів</h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "20px" }}>
              Завантажте XML з документами з 1С. Імпортовані як підтверджені (без зміни залишків). Дублікати за номером пропускаються.
            </p>

            <div className="flex gap-3 mb-4">
              <button onClick={() => { setDocType("purchase"); resetForm(); }}
                style={{
                  padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 500,
                  background: docType === "purchase" ? "#FFD600" : "white",
                  border: `1px solid ${docType === "purchase" ? "#FFD600" : "#E5E7EB"}`,
                }}>
                Прихідні накладні
              </button>
              <button onClick={() => { setDocType("sales"); resetForm(); }}
                style={{
                  padding: "8px 16px", borderRadius: "8px", fontSize: "14px", fontWeight: 500,
                  background: docType === "sales" ? "#FFD600" : "white",
                  border: `1px solid ${docType === "sales" ? "#FFD600" : "#E5E7EB"}`,
                }}>
                Документи продажу
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Файл (XML)</label>
              <input type="file" accept=".xml" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }}
                style={{ fontSize: "14px" }} />
            </div>

            <div className="flex gap-3 mb-6">
              <button onClick={handlePreview} disabled={!file || loading}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: !file || loading ? 0.5 : 1 }}>
                {loading ? "..." : "Попередній перегляд"}
              </button>
              {preview && (
                <button onClick={handleImport} disabled={loading}
                  style={{ background: "#FFD600", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: loading ? 0.5 : 1 }}>
                  {loading ? "Імпортую..." : `Імпортувати (${preview.count})`}
                </button>
              )}
            </div>

            {/* Preview */}
            {preview && !result && (
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>Знайдено: {preview.count} документів</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Номер</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Дата</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Контрагент</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: "#6B7280" }}>Рядків</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items?.map((item, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>{item.number}</td>
                          <td style={{ padding: "6px 8px" }}>{item.date}</td>
                          <td style={{ padding: "6px 8px" }}>{item.supplierCode || item.customerCode || "—"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.items?.length || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(preview.count || 0) > 20 && <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "8px" }}>Показано перші 20...</p>}
                </div>
              </div>
            )}

            {/* Result */}
            {result && <ResultCard result={result} label="документів" />}

            <div className="flex justify-between mt-4">
              <button onClick={() => { setStep("counterparties"); resetForm(); }}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Назад
              </button>
              <button onClick={goNext}
                style={{ background: "#FFD600", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                {result ? "Завершити" : "Пропустити"}
              </button>
            </div>
          </div>
        )}

        {/* Step: Done */}
        {step === "done" && (
          <div className="bg-white rounded-xl p-8 text-center" style={{ border: "1px solid #EFEFEF" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>&#10003;</div>
            <h2 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>Імпорт завершено</h2>

            {allResults.length > 0 ? (
              <div className="text-left max-w-md mx-auto mt-6 space-y-3">
                {allResults.map((r, i) => (
                  <div key={i} style={{ padding: "12px 16px", background: "#F9FAFB", borderRadius: "8px" }}>
                    <p style={{ fontWeight: 600, fontSize: "14px" }}>{r.step}</p>
                    <p style={{ fontSize: "13px", color: "#6B7280" }}>
                      {r.result.created !== undefined && `Створено: ${r.result.created}`}
                      {r.result.updated !== undefined && `, Оновлено: ${r.result.updated}`}
                      {r.result.imported !== undefined && `Імпортовано: ${r.result.imported}`}
                      {r.result.skipped !== undefined && `, Пропущено: ${r.result.skipped}`}
                      {r.result.errors && r.result.errors.length > 0 && `, Помилок: ${r.result.errors.length}`}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Нічого не було імпортовано</p>
            )}

            <div className="flex gap-3 justify-center mt-8">
              <button onClick={() => { setStep("counterparties"); setAllResults([]); resetForm(); }}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px" }}>
                Новий імпорт
              </button>
              <Link href="/admin" style={{ background: "#FFD600", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", display: "inline-block" }}>
                На головну
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultCard({ result, label }: { result: ImportResult; label: string }) {
  return (
    <div style={{ padding: "16px", background: "#F0FDF4", borderRadius: "8px", border: "1px solid #BBF7D0" }}>
      <p style={{ fontWeight: 600, fontSize: "15px", color: "#16A34A", marginBottom: "8px" }}>Імпорт завершено</p>
      <div className="grid grid-cols-3 gap-4 text-center mb-3">
        {result.created !== undefined && (
          <div><p style={{ fontSize: "20px", fontWeight: 700 }}>{result.created}</p><p style={{ fontSize: "12px", color: "#6B7280" }}>Створено</p></div>
        )}
        {result.updated !== undefined && (
          <div><p style={{ fontSize: "20px", fontWeight: 700 }}>{result.updated}</p><p style={{ fontSize: "12px", color: "#6B7280" }}>Оновлено</p></div>
        )}
        {result.imported !== undefined && (
          <div><p style={{ fontSize: "20px", fontWeight: 700 }}>{result.imported}</p><p style={{ fontSize: "12px", color: "#6B7280" }}>Імпортовано</p></div>
        )}
        {result.skipped !== undefined && (
          <div><p style={{ fontSize: "20px", fontWeight: 700 }}>{result.skipped}</p><p style={{ fontSize: "12px", color: "#6B7280" }}>Пропущено</p></div>
        )}
      </div>
      {result.errors && result.errors.length > 0 && (
        <div style={{ marginTop: "8px" }}>
          <p style={{ fontSize: "13px", fontWeight: 600, color: "#DC2626", marginBottom: "4px" }}>Помилки ({result.errors.length}):</p>
          <div style={{ maxHeight: "120px", overflow: "auto", fontSize: "12px", color: "#6B7280" }}>
            {result.errors.map((e, i) => <p key={i}>{e}</p>)}
          </div>
        </div>
      )}
    </div>
  );
}
