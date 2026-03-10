"use client";

import { useSession } from "next-auth/react";
import { useState, useRef } from "react";
import Link from "next/link";

type Step = "products" | "counterparties" | "documents" | "done";
type ImportResult = { created?: number; updated?: number; imported?: number; skipped?: number; errors?: string[]; total?: number; count?: number; items?: any[] };
type Progress = { current: number; total: number; created: number; skipped: number; updated: number; errors: string[] };

const BATCH_SIZE = 100;

export default function ImportPage() {
  const { data: session } = useSession();
  const [step, setStep] = useState<Step>("products");
  const [file, setFile] = useState<File | null>(null);
  const [docType, setDocType] = useState<"purchase" | "sales">("purchase");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [allResults, setAllResults] = useState<{ step: string; result: ImportResult }[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);
  const cancelRef = useRef(false);

  const role = (session?.user as any)?.role;

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  const resetForm = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setProgress(null);
    cancelRef.current = false;
  };

  // --- Products CSV handlers ---
  const handleProductsPreview = async () => {
    if (!file) return;
    setLoading(true);
    setPreview(null);
    setResult(null);
    setProgress(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "preview");

      const res = await fetch("/api/erp/import/products", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (res.ok) {
        setPreview(data);
      } else {
        alert(data.error || "Помилка");
      }
    } catch (e: any) {
      alert(`Помилка: ${e.message}`);
    }
    setLoading(false);
  };

  const handleProductsImport = async () => {
    if (!file || !preview) return;
    setLoading(true);
    cancelRef.current = false;

    // Parse CSV on client to get all items
    const text = await file.text();
    const lines = text.trim().split("\n");
    const sep = lines[0].includes(";") ? ";" : ",";
    const headers = lines[0].split(sep).map((h) => h.trim().replace(/^"(.*)"$/, "$1").toLowerCase());
    const nameIdx = headers.findIndex((h) => ["product_name", "name", "назва", "найменування", "наименование", "товар"].includes(h));
    const skuIdx = headers.findIndex((h) => ["sku", "артикул", "код", "id"].includes(h));
    const priceIdx = headers.findIndex((h) => ["price", "ціна", "цена"].includes(h));
    const stockIdx = headers.findIndex((h) => ["stock", "залишок", "остаток", "кількість"].includes(h));
    const catIdx = headers.findIndex((h) => ["category", "категорія", "категория"].includes(h));

    const allItems: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i].trim(), sep);
      const name = cols[nameIdx]?.trim().replace(/^"(.*)"$/, "$1");
      if (!name || name.length < 3) continue;
      allItems.push({
        name,
        sku: skuIdx >= 0 ? cols[skuIdx]?.trim().replace(/^"(.*)"$/, "$1") : undefined,
        price: priceIdx >= 0 ? parseFloat(cols[priceIdx]?.replace(",", ".").replace(/\s/g, "")) : undefined,
        stock: stockIdx >= 0 ? parseInt(cols[stockIdx]?.trim(), 10) : undefined,
        category: catIdx >= 0 ? cols[catIdx]?.trim().replace(/^"(.*)"$/, "$1") : undefined,
      });
    }

    const total = allItems.length;
    const prog: Progress = { current: 0, total, created: 0, skipped: 0, updated: 0, errors: [] };
    setProgress({ ...prog });

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (cancelRef.current) break;

      const batch = allItems.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("/api/erp/import/products/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch }),
        });
        const data = await res.json();
        if (res.ok) {
          prog.created += data.created || 0;
          prog.skipped += data.skipped || 0;
          if (data.errors) prog.errors.push(...data.errors);
        } else {
          prog.errors.push(data.error || `Помилка batch ${i}`);
        }
      } catch (e: any) {
        prog.errors.push(`Batch ${i}: ${e.message}`);
      }
      prog.current = Math.min(i + BATCH_SIZE, total);
      setProgress({ ...prog });
    }

    const finalResult: ImportResult = {
      created: prog.created,
      skipped: prog.skipped,
      errors: prog.errors.slice(0, 30),
      total: prog.total,
    };
    setResult(finalResult);
    setProgress(null);
    setAllResults((prev) => [...prev, { step: "Товари (CSV)", result: finalResult }]);
    setLoading(false);
  };

  // --- Counterparties handler with batching ---
  const handleCounterpartiesPreview = async () => {
    if (!file) return;
    setLoading(true);
    setPreview(null);
    setResult(null);
    setProgress(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", "preview");

    const res = await fetch("/api/erp/import/counterparties", { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) {
      setPreview(data);
    } else {
      alert(data.error || "Помилка");
    }
    setLoading(false);
  };

  const handleCounterpartiesImport = async () => {
    if (!file || !preview) return;
    setLoading(true);
    cancelRef.current = false;

    // Get all parsed items via preview (returns all)
    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", "preview");
    const previewRes = await fetch("/api/erp/import/counterparties", { method: "POST", body: formData });
    const previewData = await previewRes.json();

    if (!previewRes.ok) {
      alert(previewData.error || "Помилка");
      setLoading(false);
      return;
    }

    const allItems = previewData.items || [];
    const total = allItems.length;
    const prog: Progress = { current: 0, total, created: 0, skipped: 0, updated: 0, errors: [] };
    setProgress({ ...prog });

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (cancelRef.current) break;

      const batch = allItems.slice(i, i + BATCH_SIZE);
      try {
        const res = await fetch("/api/erp/import/counterparties/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: batch }),
        });
        const data = await res.json();
        if (res.ok) {
          prog.created += data.created || 0;
          prog.updated += data.updated || 0;
          if (data.errors) prog.errors.push(...data.errors);
        } else {
          prog.errors.push(data.error || `Помилка batch ${i}`);
        }
      } catch (e: any) {
        prog.errors.push(`Batch ${i}: ${e.message}`);
      }
      prog.current = Math.min(i + BATCH_SIZE, total);
      setProgress({ ...prog });
    }

    const finalResult: ImportResult = {
      created: prog.created,
      updated: prog.updated,
      errors: prog.errors.slice(0, 30),
      total: prog.total,
    };
    setResult(finalResult);
    setProgress(null);
    setAllResults((prev) => [...prev, { step: "Контрагенти", result: finalResult }]);
    setLoading(false);
  };

  // --- Documents handlers (no batching needed - typically small) ---
  const handleDocPreview = async () => {
    if (!file) return;
    setLoading(true);
    setPreview(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("mode", "preview");
    formData.append("type", docType);

    const res = await fetch("/api/erp/import/documents", { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) setPreview(data);
    else alert(data.error || "Помилка");
    setLoading(false);
  };

  const handleDocImport = async () => {
    if (!file) return;
    setLoading(true);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("type", docType);

    const res = await fetch("/api/erp/import/documents", { method: "POST", body: formData });
    const data = await res.json();

    if (res.ok) {
      setResult(data);
      setAllResults((prev) => [...prev, { step: docType === "purchase" ? "Закупівлі" : "Продажі", result: data }]);
    } else {
      alert(data.error || "Помилка");
    }
    setLoading(false);
  };

  const goNext = () => {
    if (step === "products") setStep("counterparties");
    else if (step === "counterparties") setStep("documents");
    else setStep("done");
    resetForm();
  };

  const STEPS = [
    { key: "products", label: "1. Товари" },
    { key: "counterparties", label: "2. Контрагенти" },
    { key: "documents", label: "3. Документи" },
    { key: "done", label: "4. Готово" },
  ];

  const progressPercent = progress ? Math.round((progress.current / progress.total) * 100) : 0;

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

        {/* Step: Products CSV Import */}
        {step === "products" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Імпорт товарів (CSV)</h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "20px" }}>
              Завантажте CSV файл з товарами. Колонка <strong>product_name</strong> (або назва, товар) — обов&#39;язкова.
              Додатково: sku, price, stock, category.
            </p>

            <div style={{ padding: "12px 16px", background: "#EFF6FF", borderRadius: "8px", border: "1px solid #BFDBFE", marginBottom: "20px" }}>
              <p style={{ fontSize: "13px", color: "#1E40AF" }}>
                <strong>Підказка:</strong> Щоб отримати CSV з файлу 1С (.dt), запустіть на комп&#39;ютері:<br/>
                <code style={{ background: "#DBEAFE", padding: "2px 6px", borderRadius: "4px", fontSize: "12px" }}>
                  python3 scripts/convert-1c-dt.py &quot;файл.dt&quot; output/
                </code>
              </p>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">Файл (CSV або TXT)</label>
              <input
                type="file"
                accept=".csv,.txt"
                onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); setProgress(null); }}
                style={{ fontSize: "14px" }}
              />
              {file && (
                <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "4px" }}>
                  {file.name} ({(file.size / 1024).toFixed(0)} КБ)
                </p>
              )}
            </div>

            <div className="flex gap-3 mb-6">
              <button
                onClick={handleProductsPreview}
                disabled={!file || loading}
                style={{
                  background: "white", border: "1px solid #E5E7EB", padding: "10px 20px",
                  borderRadius: "8px", fontWeight: 600, fontSize: "14px",
                  opacity: !file || loading ? 0.5 : 1, cursor: !file || loading ? "not-allowed" : "pointer",
                }}
              >
                {loading && !preview && !progress ? "Обробляю..." : "Попередній перегляд"}
              </button>
              {preview && !result && !progress && (
                <button
                  onClick={handleProductsImport}
                  disabled={loading}
                  style={{
                    background: "#FFD600", padding: "10px 20px", borderRadius: "8px",
                    fontWeight: 600, fontSize: "14px", opacity: loading ? 0.5 : 1,
                    cursor: loading ? "not-allowed" : "pointer",
                  }}
                >
                  Імпортувати ({preview.count} товарів)
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {progress && <ProgressBar progress={progress} onCancel={() => { cancelRef.current = true; }} />}

            {/* Products Preview */}
            {preview && !result && !progress && (
              <div style={{ marginBottom: "16px" }}>
                <p style={{ fontSize: "14px", fontWeight: 600, marginBottom: "8px" }}>
                  Знайдено: {preview.count} товарів
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ borderBottom: "1px solid #EFEFEF" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280", width: "40px" }}>#</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>Назва</th>
                        <th style={{ padding: "6px 8px", textAlign: "left", color: "#6B7280" }}>SKU</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: "#6B7280" }}>Ціна</th>
                        <th style={{ padding: "6px 8px", textAlign: "right", color: "#6B7280" }}>Залишок</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items?.map((item: any, i: number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "6px 8px", color: "#9CA3AF" }}>{i + 1}</td>
                          <td style={{ padding: "6px 8px" }}>{item.name}</td>
                          <td style={{ padding: "6px 8px", color: "#6B7280", fontSize: "12px" }}>{item.sku}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.price || 0}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.stock || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(preview.count || 0) > 50 && (
                    <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "8px" }}>Показано перші 50 з {preview.count}...</p>
                  )}
                </div>
              </div>
            )}

            {/* Products Result */}
            {result && <ResultCard result={result} label="товарів" />}

            <div className="flex justify-end mt-4">
              <button onClick={goNext} disabled={!!progress}
                style={{ background: "#FFD600", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: progress ? 0.5 : 1 }}>
                {result ? "Далі: Контрагенти" : "Пропустити"}
              </button>
            </div>
          </div>
        )}

        {/* Step: Counterparties */}
        {step === "counterparties" && (
          <div className="bg-white rounded-xl p-6" style={{ border: "1px solid #EFEFEF" }}>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "8px" }}>Імпорт контрагентів</h2>
            <p style={{ fontSize: "14px", color: "#6B7280", marginBottom: "20px" }}>
              Завантажте XML (вигрузка з 1С) або CSV файл з контрагентами. Існуючі контрагенти будуть оновлені за кодом.
            </p>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 mb-2">Файл (XML або CSV)</label>
              <input type="file" accept=".xml,.csv,.txt" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); setProgress(null); }}
                style={{ fontSize: "14px" }} />
            </div>

            <div className="flex gap-3 mb-6">
              <button onClick={handleCounterpartiesPreview} disabled={!file || loading}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: !file || loading ? 0.5 : 1 }}>
                {loading && !preview && !progress ? "..." : "Попередній перегляд"}
              </button>
              {preview && !result && !progress && (
                <button onClick={handleCounterpartiesImport} disabled={loading}
                  style={{ background: "#FFD600", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: loading ? 0.5 : 1 }}>
                  Імпортувати ({preview.count})
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {progress && <ProgressBar progress={progress} onCancel={() => { cancelRef.current = true; }} />}

            {/* Preview */}
            {preview && !result && !progress && (
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
                      {preview.items?.map((item: any, i: number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "6px 8px" }}>{item.code}</td>
                          <td style={{ padding: "6px 8px" }}>{item.name}</td>
                          <td style={{ padding: "6px 8px" }}>{item.type}</td>
                          <td style={{ padding: "6px 8px" }}>{item.phone || "\u2014"}</td>
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

            <div className="flex justify-between mt-4">
              <button onClick={() => { setStep("products"); resetForm(); }} disabled={!!progress}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: progress ? 0.5 : 1 }}>
                Назад
              </button>
              <button onClick={goNext} disabled={!!progress}
                style={{ background: "#FFD600", padding: "10px 24px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: progress ? 0.5 : 1 }}>
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
              Завантажте XML з документами з 1С. Дублікати за номером пропускаються.
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
              <label className="block text-sm font-medium text-gray-600 mb-2">Файл (XML)</label>
              <input type="file" accept=".xml" onChange={(e) => { setFile(e.target.files?.[0] || null); setPreview(null); setResult(null); }}
                style={{ fontSize: "14px" }} />
            </div>

            <div className="flex gap-3 mb-6">
              <button onClick={handleDocPreview} disabled={!file || loading}
                style={{ background: "white", border: "1px solid #E5E7EB", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: !file || loading ? 0.5 : 1 }}>
                {loading ? "..." : "Попередній перегляд"}
              </button>
              {preview && (
                <button onClick={handleDocImport} disabled={loading}
                  style={{ background: "#FFD600", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: loading ? 0.5 : 1 }}>
                  {loading ? "Імпортую..." : `Імпортувати (${preview.count})`}
                </button>
              )}
            </div>

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
                      {preview.items?.map((item: any, i: number) => (
                        <tr key={i} style={{ borderBottom: "1px solid #F3F4F6" }}>
                          <td style={{ padding: "6px 8px", fontWeight: 600 }}>{item.number}</td>
                          <td style={{ padding: "6px 8px" }}>{item.date}</td>
                          <td style={{ padding: "6px 8px" }}>{item.supplierCode || item.customerCode || "\u2014"}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{item.items?.length || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

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
              <button onClick={() => { setStep("products"); setAllResults([]); resetForm(); }}
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

// --- Progress Bar Component ---
function ProgressBar({ progress, onCancel }: { progress: Progress; onCancel: () => void }) {
  const percent = Math.round((progress.current / progress.total) * 100);

  return (
    <div style={{ padding: "20px", background: "#F9FAFB", borderRadius: "12px", border: "1px solid #E5E7EB", marginBottom: "16px" }}>
      <div className="flex justify-between items-center mb-3">
        <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>
          Імпорт: {progress.current} / {progress.total}
        </p>
        <p style={{ fontSize: "24px", fontWeight: 700, color: "#FFD600" }}>{percent}%</p>
      </div>

      {/* Bar */}
      <div style={{ height: "12px", background: "#E5E7EB", borderRadius: "6px", overflow: "hidden", marginBottom: "12px" }}>
        <div
          style={{
            height: "100%",
            width: `${percent}%`,
            background: "linear-gradient(90deg, #FFD600, #FFA000)",
            borderRadius: "6px",
            transition: "width 0.3s ease",
          }}
        />
      </div>

      {/* Stats */}
      <div className="flex gap-6 mb-3">
        <p style={{ fontSize: "13px", color: "#16A34A" }}>Створено: <strong>{progress.created}</strong></p>
        {progress.updated > 0 && <p style={{ fontSize: "13px", color: "#2563EB" }}>Оновлено: <strong>{progress.updated}</strong></p>}
        {progress.skipped > 0 && <p style={{ fontSize: "13px", color: "#9CA3AF" }}>Пропущено: <strong>{progress.skipped}</strong></p>}
        {progress.errors.length > 0 && <p style={{ fontSize: "13px", color: "#DC2626" }}>Помилок: <strong>{progress.errors.length}</strong></p>}
      </div>

      <button onClick={onCancel}
        style={{ background: "white", border: "1px solid #E5E7EB", padding: "6px 16px", borderRadius: "6px", fontSize: "13px", fontWeight: 500, color: "#6B7280", cursor: "pointer" }}>
        Скасувати
      </button>
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

// --- CSV Parser (client-side) ---
function parseCSVLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}
