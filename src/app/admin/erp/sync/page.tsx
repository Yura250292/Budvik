"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";

interface PreviewItem {
  sku?: string;
  code?: string;
  name?: string;
  number?: string;
  counterpartyCode?: string;
  counterpartyName?: string;
  action: string;
  changes?: { field: string; from: string; to: string }[];
  mismatches?: { field: string; from: string; to: string }[];
  // Document fields
  date?: string;
  customer?: string;
  supplier?: string;
  itemCount?: number;
  total1C?: number;
  totalBudvik?: number;
  // Debt fields
  debt1C?: number;
  debtBudvik?: number;
  difference?: number;
}

interface PreviewResult {
  type: string;
  total: number;
  // Products/Counterparties
  toCreate?: number;
  toUpdate?: number;
  unchanged?: number;
  // Documents
  matched?: number;
  mismatched?: number;
  missing?: number;
  // Debt
  onlyIn1C?: number;
  totalDebt1C?: number;
  totalDebtBudvik?: number;
  items: PreviewItem[];
}

interface SyncResult {
  syncJobId: string;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: string[];
  discrepancies: number;
}

interface SyncJob {
  id: string;
  type: string;
  status: string;
  fileName: string;
  recordsTotal: number;
  recordsCreated: number;
  recordsUpdated: number;
  recordsSkipped: number;
  recordsFailed: number;
  createdAt: string;
  completedAt: string | null;
  _count: { discrepancies: number };
}

interface Discrepancy {
  id: string;
  entityType: string;
  entityRef: string;
  entityName: string;
  field: string;
  value1C: string;
  valueBudvik: string;
  resolved: boolean;
  createdAt: string;
  syncJob: { fileName: string; createdAt: string };
}

type Tab = "sync" | "history" | "discrepancies";

export default function SyncPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;

  const [tab, setTab] = useState<Tab>("sync");
  const [syncType, setSyncType] = useState<"products" | "counterparties" | "sales_documents" | "purchase_orders" | "debt">("products");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Preview state
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);

  // Apply state
  const [applying, setApplying] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  // Error
  const [error, setError] = useState("");

  // History
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // Discrepancies
  const [discrepancies, setDiscrepancies] = useState<Discrepancy[]>([]);
  const [loadingDisc, setLoadingDisc] = useState(false);
  const [discFilter, setDiscFilter] = useState<"all" | "unresolved">("unresolved");

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await fetch("/api/erp/sync/jobs");
      if (res.ok) setJobs(await res.json());
    } catch {} finally {
      setLoadingJobs(false);
    }
  }, []);

  const fetchDiscrepancies = useCallback(async () => {
    setLoadingDisc(true);
    try {
      const params = new URLSearchParams();
      if (discFilter === "unresolved") params.set("resolved", "false");
      const res = await fetch(`/api/erp/sync/discrepancies?${params}`);
      if (res.ok) setDiscrepancies(await res.json());
    } catch {} finally {
      setLoadingDisc(false);
    }
  }, [discFilter]);

  useEffect(() => {
    if (tab === "history") fetchJobs();
    if (tab === "discrepancies") fetchDiscrepancies();
  }, [tab, fetchJobs, fetchDiscrepancies]);

  if (role !== "ADMIN" && role !== "MANAGER") {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Доступ заборонено</h1>
      </div>
    );
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setPreview(null);
      setSyncResult(null);
      setError("");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setPreview(null);
    setSyncResult(null);
    setError("");
  };

  const handlePreview = async () => {
    if (!file) return;
    setPreviewing(true);
    setPreview(null);
    setSyncResult(null);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", syncType);

      const res = await fetch("/api/erp/sync/preview", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Помилка preview");
        return;
      }

      setPreview(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPreviewing(false);
    }
  };

  const handleApply = async () => {
    if (!file) return;
    setApplying(true);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", syncType);

      const res = await fetch("/api/erp/sync/apply", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Помилка синхронізації");
        return;
      }

      setSyncResult(data);
      setPreview(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setApplying(false);
    }
  };

  const handleResolve = async (id: string) => {
    await fetch("/api/erp/sync/discrepancies", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved: true }),
    });
    fetchDiscrepancies();
  };

  const resetForm = () => {
    setFile(null);
    setPreview(null);
    setSyncResult(null);
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const fieldLabel: Record<string, string> = {
    price: "Ціна",
    stock: "Залишок",
    name: "Назва",
    phone: "Телефон",
    address: "Адреса",
    email: "Email",
    NEW: "Новий запис",
    MISSING: "Відсутній в 1С",
    totalAmount: "Сума документа",
    itemCount: "Кількість позицій",
    debt_amount: "Сума боргу",
    only_in_1c: "Тільки в 1С",
  };

  const typeLabel: Record<string, string> = {
    products: "Товари",
    counterparties: "Контрагенти",
    sales_documents: "Продажі",
    purchase_orders: "Закупівлі",
    debt: "Дебіторка",
    product: "Товар",
    counterparty: "Контрагент",
    sales_document: "Продаж",
    purchase_order: "Закупівля",
  };

  function hasChanges(p: PreviewResult): boolean {
    if (p.toCreate && p.toCreate > 0) return true;
    if (p.toUpdate && p.toUpdate > 0) return true;
    if (p.missing && p.missing > 0) return true;
    if (p.mismatched && p.mismatched > 0) return true;
    if (p.onlyIn1C && p.onlyIn1C > 0) return true;
    return false;
  }

  function countChanges(p: PreviewResult): number {
    return (p.toCreate || 0) + (p.toUpdate || 0) + (p.missing || 0) + (p.mismatched || 0) + (p.onlyIn1C || 0);
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-g400 hover:text-g600">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Синхронізація з 1С</h1>
          <p className="text-sm text-g400">Паралельне тестування — Budvik тільки читає дані з 1С</p>
        </div>
      </div>

      {/* Safety banner */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-6 flex items-start gap-3">
        <svg className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        <div className="text-sm text-green-800">
          <strong>Безпечний режим:</strong> Budvik ніколи не пише назад у 1С. Всі зміни можна переглянути перед застосуванням.
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-g100 rounded-lg p-1 max-w-md">
        {([
          { key: "sync", label: "Синхронізація" },
          { key: "history", label: "Історія" },
          { key: "discrepancies", label: "Розбіжності" },
        ] as const).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition ${
              tab === t.key ? "bg-white shadow text-primary" : "text-g500 hover:text-bk"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== SYNC TAB ===== */}
      {tab === "sync" && (
        <div className="space-y-6">
          {/* Type selector */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Тип даних</h2>
            <div className="flex flex-wrap gap-3">
              {([
                { key: "products" as const, title: "Товари", desc: "Назва, артикул, ціна, залишки" },
                { key: "counterparties" as const, title: "Контрагенти", desc: "Код, назва, телефон, адреса" },
                { key: "sales_documents" as const, title: "Продажі", desc: "Документи продажів, суми" },
                { key: "purchase_orders" as const, title: "Закупівлі", desc: "Документи закупівель" },
                { key: "debt" as const, title: "Дебіторка", desc: "Заборгованість по контрагентах" },
              ]).map((t) => (
                <button
                  key={t.key}
                  onClick={() => { setSyncType(t.key); resetForm(); }}
                  className={`px-4 py-3 rounded-lg text-sm font-medium border-2 transition text-left ${
                    syncType === t.key
                      ? "border-primary bg-primary/10 text-primary-dark"
                      : "border-g200 text-g500 hover:border-g300"
                  }`}
                >
                  <div className="font-semibold mb-0.5">{t.title}</div>
                  <div className="text-xs text-g400">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* File upload */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">
              Завантаження файлу з 1С
            </h2>

            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition cursor-pointer ${
                dragOver ? "border-primary bg-primary/5" :
                file ? "border-primary bg-primary/10" : "border-g300 hover:border-g400"
              }`}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xml,.csv,.txt"
                className="hidden"
                onChange={handleFileChange}
              />
              {file ? (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-primary mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-primary-dark font-medium mb-1">{file.name}</p>
                  <p className="text-sm text-primary">{(file.size / 1024).toFixed(1)} KB</p>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-g400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-g500 mb-1">Перетягніть файл сюди або натисніть</p>
                  <p className="text-sm text-g400">.csv, .txt або .xml (CommerceML)</p>
                </>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3 mt-4">
              <button
                onClick={handlePreview}
                disabled={!file || previewing}
                className="bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {previewing ? "Аналіз..." : "Порівняти (dry-run)"}
              </button>
              {preview && hasChanges(preview) && (
                <button
                  onClick={handleApply}
                  disabled={applying}
                  className="bg-primary text-bk px-6 py-2.5 rounded-lg hover:bg-primary-hover transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                >
                  {applying ? "Синхронізація..." : `Застосувати (${countChanges(preview)} змін)`}
                </button>
              )}
              {(preview || syncResult) && (
                <button
                  onClick={resetForm}
                  className="px-4 py-2.5 rounded-lg border border-g300 text-g500 hover:text-bk hover:border-g400 transition text-sm"
                >
                  Скинути
                </button>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Preview results */}
          {preview && (
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold mb-4">Результат порівняння</h2>

              {/* Summary stats — universal */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <div className="bg-g50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{preview.total}</div>
                  <div className="text-xs text-g400">В файлі</div>
                </div>
                {preview.type === "debt" ? (
                  <>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">{preview.matched || 0}</div>
                      <div className="text-xs text-g400">Збігається</div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-600">{preview.mismatched || 0}</div>
                      <div className="text-xs text-g400">Розбіжність</div>
                    </div>
                    <div className="bg-red-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-red-600">{preview.onlyIn1C || 0}</div>
                      <div className="text-xs text-g400">Тільки в 1С</div>
                    </div>
                  </>
                ) : preview.type === "sales_documents" || preview.type === "purchase_orders" ? (
                  <>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">{preview.matched || 0}</div>
                      <div className="text-xs text-g400">Збігається</div>
                    </div>
                    <div className="bg-orange-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-orange-600">{preview.mismatched || 0}</div>
                      <div className="text-xs text-g400">Різні суми</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600">{preview.missing || 0}</div>
                      <div className="text-xs text-g400">Відсутні в Budvik</div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-green-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-green-600">{preview.toCreate || 0}</div>
                      <div className="text-xs text-g400">Нових</div>
                    </div>
                    <div className="bg-blue-50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-blue-600">{preview.toUpdate || 0}</div>
                      <div className="text-xs text-g400">Оновити</div>
                    </div>
                    <div className="bg-g50 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-g400">{preview.unchanged || 0}</div>
                      <div className="text-xs text-g400">Без змін</div>
                    </div>
                  </>
                )}
              </div>

              {/* Debt totals */}
              {preview.type === "debt" && (preview.totalDebt1C || preview.totalDebtBudvik) && (
                <div className="grid grid-cols-2 gap-3 mb-6">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                    <div className="text-xs text-g400 mb-1">Загальний борг в 1С</div>
                    <div className="text-xl font-bold text-yellow-700">{preview.totalDebt1C?.toLocaleString("uk-UA")} грн</div>
                  </div>
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-center">
                    <div className="text-xs text-g400 mb-1">Загальний борг в Budvik</div>
                    <div className="text-xl font-bold text-yellow-700">{preview.totalDebtBudvik?.toLocaleString("uk-UA")} грн</div>
                  </div>
                </div>
              )}

              {/* Changes table */}
              {preview.items.filter((i) => i.action !== "unchanged" && i.action !== "matched").length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-g400">
                        <th className="py-2 pr-3">Дія</th>
                        <th className="py-2 pr-3">
                          {syncType === "debt" ? "Контрагент" :
                           syncType === "sales_documents" || syncType === "purchase_orders" ? "Номер" :
                           syncType === "products" ? "SKU" : "Код"}
                        </th>
                        <th className="py-2 pr-3">
                          {syncType === "debt" ? "Борг 1С / Budvik" :
                           syncType === "sales_documents" || syncType === "purchase_orders" ? "Контрагент" : "Назва"}
                        </th>
                        <th className="py-2 pr-3">Деталі</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.items
                        .filter((i) => i.action !== "unchanged" && i.action !== "matched")
                        .slice(0, 100)
                        .map((item, idx) => (
                          <tr key={idx} className="border-b hover:bg-g50">
                            <td className="py-2 pr-3">
                              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                                item.action === "create" ? "bg-green-100 text-green-700" :
                                item.action === "mismatch" ? "bg-orange-100 text-orange-700" :
                                item.action === "only_in_1c" ? "bg-red-100 text-red-700" :
                                "bg-blue-100 text-blue-700"
                              }`}>
                                {item.action === "create" ? "Новий" :
                                 item.action === "mismatch" ? "Розбіжність" :
                                 item.action === "only_in_1c" ? "Тільки в 1С" : "Оновити"}
                              </span>
                            </td>
                            <td className="py-2 pr-3 font-mono text-xs max-w-[150px] truncate">
                              {item.number || item.counterpartyName || item.sku || item.code}
                            </td>
                            <td className="py-2 pr-3 max-w-[200px] truncate text-xs">
                              {syncType === "debt" ? (
                                <span>{item.debt1C?.toLocaleString("uk-UA")} / {item.debtBudvik?.toLocaleString("uk-UA")} грн</span>
                              ) : (
                                item.customer || item.supplier || item.name
                              )}
                            </td>
                            <td className="py-2 pr-3 text-xs">
                              {(item.changes || item.mismatches)?.map((c, ci) => (
                                <div key={ci}>
                                  <span className="text-g400">{fieldLabel[c.field] || c.field}:</span>{" "}
                                  <span className="text-red-500">{c.from}</span>{" → "}
                                  <span className="text-green-600">{c.to}</span>
                                </div>
                              ))}
                              {item.action === "create" && item.total1C && (
                                <span className="text-green-600">{item.itemCount} поз., {item.total1C?.toLocaleString("uk-UA")} грн</span>
                              )}
                              {item.action === "create" && !item.total1C && <span className="text-green-600">Новий запис</span>}
                              {item.action === "only_in_1c" && <span className="text-red-500">Борг: {item.debt1C?.toLocaleString("uk-UA")} грн</span>}
                              {item.action === "mismatch" && item.difference !== undefined && (
                                <span className={item.difference > 0 ? "text-red-500" : "text-green-600"}>
                                  Різниця: {item.difference > 0 ? "+" : ""}{item.difference?.toLocaleString("uk-UA")} грн
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}

              {!hasChanges(preview) && (
                <div className="text-center py-8 text-g400">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="font-medium text-green-600">Дані ідентичні!</p>
                  <p className="text-sm">Budvik повністю відповідає 1С. Змін не потрібно.</p>
                </div>
              )}
            </div>
          )}

          {/* Sync result */}
          {syncResult && (
            <div className="bg-white rounded-xl shadow p-6">
              <h2 className="text-lg font-semibold mb-4 text-green-700">Синхронізацію завершено</h2>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
                <div className="bg-g50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold">{syncResult.total}</div>
                  <div className="text-xs text-g400">Всього</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-green-600">{syncResult.created}</div>
                  <div className="text-xs text-g400">Створено</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">{syncResult.updated}</div>
                  <div className="text-xs text-g400">Оновлено</div>
                </div>
                <div className="bg-g50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-g400">{syncResult.skipped}</div>
                  <div className="text-xs text-g400">Без змін</div>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">{syncResult.failed}</div>
                  <div className="text-xs text-g400">Помилок</div>
                </div>
              </div>
              {syncResult.discrepancies > 0 && (
                <p className="text-sm text-g500">
                  Записано {syncResult.discrepancies} розбіжностей.{" "}
                  <button onClick={() => setTab("discrepancies")} className="text-primary underline">
                    Переглянути
                  </button>
                </p>
              )}
              {syncResult.errors.length > 0 && (
                <div className="mt-3 text-sm text-red-600">
                  <p className="font-semibold">Помилки:</p>
                  <ul className="list-disc ml-4 mt-1">
                    {syncResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ===== HISTORY TAB ===== */}
      {tab === "history" && (
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Історія синхронізацій</h2>
            <button onClick={fetchJobs} className="text-sm text-primary hover:underline">
              Оновити
            </button>
          </div>

          {loadingJobs ? (
            <p className="text-g400">Завантаження...</p>
          ) : jobs.length === 0 ? (
            <p className="text-g400">Ще не було жодної синхронізації</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-g400">
                    <th className="py-2 pr-3">Дата</th>
                    <th className="py-2 pr-3">Файл</th>
                    <th className="py-2 pr-3">Тип</th>
                    <th className="py-2 pr-3">Статус</th>
                    <th className="py-2 pr-3">Створ.</th>
                    <th className="py-2 pr-3">Оновл.</th>
                    <th className="py-2 pr-3">Без змін</th>
                    <th className="py-2 pr-3">Помилки</th>
                    <th className="py-2 pr-3">Розбіжн.</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b hover:bg-g50">
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        {new Date(job.createdAt).toLocaleDateString("uk-UA")}{" "}
                        {new Date(job.createdAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="py-2 pr-3 max-w-[150px] truncate text-xs">{job.fileName}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          job.type === "products" ? "bg-blue-100 text-blue-700" :
                          job.type === "counterparties" ? "bg-purple-100 text-purple-700" :
                          job.type === "sales_documents" ? "bg-green-100 text-green-700" :
                          job.type === "purchase_orders" ? "bg-cyan-100 text-cyan-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {typeLabel[job.type] || job.type}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          job.status === "completed" ? "bg-green-100 text-green-700" :
                          job.status === "failed" ? "bg-red-100 text-red-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {job.status === "completed" ? "Завершено" : job.status === "failed" ? "Помилка" : "В процесі"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-green-600">{job.recordsCreated}</td>
                      <td className="py-2 pr-3 text-blue-600">{job.recordsUpdated}</td>
                      <td className="py-2 pr-3 text-g400">{job.recordsSkipped}</td>
                      <td className="py-2 pr-3 text-red-600">{job.recordsFailed}</td>
                      <td className="py-2 pr-3">
                        {job._count.discrepancies > 0 && (
                          <span className="text-orange-600 font-medium">{job._count.discrepancies}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ===== DISCREPANCIES TAB ===== */}
      {tab === "discrepancies" && (
        <div className="bg-white rounded-xl shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Розбіжності 1С / Budvik</h2>
            <div className="flex items-center gap-3">
              <select
                value={discFilter}
                onChange={(e) => setDiscFilter(e.target.value as any)}
                className="border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="unresolved">Невирішені</option>
                <option value="all">Усі</option>
              </select>
              <button onClick={fetchDiscrepancies} className="text-sm text-primary hover:underline">
                Оновити
              </button>
            </div>
          </div>

          {loadingDisc ? (
            <p className="text-g400">Завантаження...</p>
          ) : discrepancies.length === 0 ? (
            <div className="text-center py-8 text-g400">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto mb-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="font-medium text-green-600">Розбіжностей немає!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-g400">
                    <th className="py-2 pr-3">Тип</th>
                    <th className="py-2 pr-3">Код</th>
                    <th className="py-2 pr-3">Назва</th>
                    <th className="py-2 pr-3">Поле</th>
                    <th className="py-2 pr-3">Значення 1С</th>
                    <th className="py-2 pr-3">Значення Budvik</th>
                    <th className="py-2 pr-3">Дата</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {discrepancies.map((d) => (
                    <tr key={d.id} className={`border-b hover:bg-g50 ${d.resolved ? "opacity-50" : ""}`}>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          d.entityType === "product" ? "bg-blue-100 text-blue-700" :
                          d.entityType === "counterparty" ? "bg-purple-100 text-purple-700" :
                          d.entityType === "sales_document" ? "bg-green-100 text-green-700" :
                          d.entityType === "purchase_order" ? "bg-cyan-100 text-cyan-700" :
                          "bg-yellow-100 text-yellow-700"
                        }`}>
                          {typeLabel[d.entityType] || d.entityType}
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{d.entityRef}</td>
                      <td className="py-2 pr-3 max-w-[150px] truncate">{d.entityName}</td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          d.field === "NEW" ? "bg-green-100 text-green-700" :
                          d.field === "MISSING" ? "bg-red-100 text-red-700" :
                          "bg-orange-100 text-orange-700"
                        }`}>
                          {fieldLabel[d.field] || d.field}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-sm text-green-700 max-w-[120px] truncate">{d.value1C}</td>
                      <td className="py-2 pr-3 text-sm text-red-500 max-w-[120px] truncate">{d.valueBudvik}</td>
                      <td className="py-2 pr-3 text-xs text-g400 whitespace-nowrap">
                        {new Date(d.createdAt).toLocaleDateString("uk-UA")}
                      </td>
                      <td className="py-2 pr-3">
                        {!d.resolved && (
                          <button
                            onClick={() => handleResolve(d.id)}
                            className="text-xs text-primary hover:underline"
                          >
                            Вирішено
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
