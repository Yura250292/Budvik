"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

interface ImportLog {
  id: string;
  type: string;
  filename: string;
  status: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  details: string | null;
  createdAt: string;
}

interface ImportResult {
  success: boolean;
  summary: {
    total: number;
    created: number;
    updated: number;
    skipped: number;
    errors: number;
  };
  errorDetails?: string[];
}

export default function IntegrationPage() {
  const [activeTab, setActiveTab] = useState<"import" | "export">("import");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState("");
  const [logs, setLogs] = useState<ImportLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportType, setExportType] = useState<"orders" | "products">("orders");
  const [exportFormat, setExportFormat] = useState<"xml" | "csv">("xml");
  const [exportStatus, setExportStatus] = useState("");
  const [exportFrom, setExportFrom] = useState("");
  const [exportTo, setExportTo] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);

  useEffect(() => {
    fetchLogs();
  }, []);

  async function fetchLogs() {
    try {
      const res = await fetch("/api/admin/import");
      if (res.ok) setLogs(await res.json());
    } catch {} finally {
      setLoadingLogs(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
  }

  async function handleImport(e: React.FormEvent) {
    e.preventDefault();
    const file = selectedFile;
    if (!file) {
      setImportError("Оберіть файл для імпорту");
      return;
    }

    setImporting(true);
    setImportResult(null);
    setImportError("");
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("format", file.name.endsWith(".xml") ? "xml" : "csv");

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          setImportResult(data);
          setSelectedFile(null);
          if (fileRef.current) fileRef.current.value = "";
          fetchLogs();
        } else {
          setImportError(data.error || "Помилка імпорту");
        }
      } catch {
        setImportError("Помилка обробки відповіді сервера");
      }
      setImporting(false);
    };

    xhr.onerror = () => {
      setImportError("Помилка з'єднання з сервером");
      setImporting(false);
    };

    xhr.open("POST", "/api/admin/import");
    xhr.send(formData);
  }

  async function handleExport() {
    setExporting(true);
    try {
      if (exportType === "orders") {
        const params = new URLSearchParams({ format: exportFormat });
        if (exportStatus) params.set("status", exportStatus);
        if (exportFrom) params.set("from", exportFrom);
        if (exportTo) params.set("to", exportTo);

        const res = await fetch(`/api/admin/export?${params}`);
        await downloadResponse(res, exportFormat === "xml" ? "orders.xml" : "orders.csv");
      } else {
        const res = await fetch("/api/admin/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format: exportFormat }),
        });
        await downloadResponse(res, exportFormat === "xml" ? "products.xml" : "products.csv");
      }
    } catch (err: any) {
      alert("Помилка експорту: " + err.message);
    } finally {
      setExporting(false);
    }
  }

  async function downloadResponse(res: Response, filename: string) {
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/admin" className="text-gray-500 hover:text-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-2xl font-bold">Інтеграція з 1С</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 max-w-sm">
        <button
          onClick={() => setActiveTab("import")}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
            activeTab === "import" ? "bg-white shadow text-orange-600" : "text-gray-600 hover:text-gray-800"
          }`}
        >
          Імпорт
        </button>
        <button
          onClick={() => setActiveTab("export")}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition ${
            activeTab === "export" ? "bg-white shadow text-orange-600" : "text-gray-600 hover:text-gray-800"
          }`}
        >
          Експорт
        </button>
      </div>

      {activeTab === "import" && (
        <div className="space-y-6">
          {/* Import form */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Завантаження даних з 1С</h2>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-sm text-blue-800">
              <p className="font-semibold mb-2">Підтримувані формати:</p>
              <ul className="list-disc ml-4 space-y-1">
                <li><strong>CommerceML XML</strong> — стандартний формат вигрузки 1С (товари + категорії)</li>
                <li><strong>CSV</strong> — таблиця з колонками: Артикул, Назва, Ціна, Залишок, Категорія, Опис</li>
              </ul>
              <p className="mt-2 text-blue-600">
                Товари зіставляються за <strong>артикулом (SKU)</strong>. Існуючі оновлюються, нові створюються.
              </p>
            </div>

            <form onSubmit={handleImport}>
              <div className={`border-2 border-dashed rounded-lg p-8 text-center mb-4 transition ${
                selectedFile ? "border-orange-400 bg-orange-50" : "border-gray-300"
              }`}>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xml,.csv,.txt"
                  className="hidden"
                  id="import-file"
                  onChange={handleFileChange}
                />
                <label htmlFor="import-file" className="cursor-pointer">
                  {selectedFile ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-orange-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-orange-700 font-medium mb-1">{selectedFile.name}</p>
                      <p className="text-sm text-orange-500">
                        {(selectedFile.size / 1024).toFixed(1)} KB — натисніть щоб змінити файл
                      </p>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mx-auto text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      <p className="text-gray-600 mb-1">Натисніть для вибору файлу</p>
                      <p className="text-sm text-gray-400">.xml (CommerceML) або .csv</p>
                    </>
                  )}
                </label>
              </div>

              {importing && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">
                      {uploadProgress < 100 ? "Завантаження файлу..." : "Обробка на сервері..."}
                    </span>
                    <span className="font-medium text-orange-600">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-orange-500 h-full rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={importing || !selectedFile}
                className="bg-orange-600 text-white px-6 py-2.5 rounded-lg hover:bg-orange-500 transition disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {importing ? "Імпортується..." : "Імпортувати"}
              </button>
            </form>

            {importError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                {importError}
              </div>
            )}

            {importResult && (
              <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="font-semibold text-green-800 mb-2">Імпорт завершено</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-gray-800">{importResult.summary.total}</div>
                    <div className="text-gray-500">Всього</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-green-600">{importResult.summary.created}</div>
                    <div className="text-gray-500">Створено</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-blue-600">{importResult.summary.updated}</div>
                    <div className="text-gray-500">Оновлено</div>
                  </div>
                  <div className="bg-white rounded p-3 text-center">
                    <div className="text-2xl font-bold text-red-600">{importResult.summary.errors}</div>
                    <div className="text-gray-500">Помилок</div>
                  </div>
                </div>
                {importResult.errorDetails && importResult.errorDetails.length > 0 && (
                  <div className="mt-3 text-sm text-red-600">
                    <p className="font-semibold">Деталі помилок:</p>
                    <ul className="list-disc ml-4 mt-1">
                      {importResult.errorDetails.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Import history */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Історія імпортів</h2>
            {loadingLogs ? (
              <p className="text-gray-500">Завантаження...</p>
            ) : logs.length === 0 ? (
              <p className="text-gray-500">Ще не було жодного імпорту</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-gray-500">
                      <th className="py-2 pr-4">Дата</th>
                      <th className="py-2 pr-4">Файл</th>
                      <th className="py-2 pr-4">Тип</th>
                      <th className="py-2 pr-4">Статус</th>
                      <th className="py-2 pr-4">Створ.</th>
                      <th className="py-2 pr-4">Оновл.</th>
                      <th className="py-2 pr-4">Помилки</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((log) => (
                      <tr key={log.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 pr-4 whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleDateString("uk-UA")} {new Date(log.createdAt).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-2 pr-4 max-w-[200px] truncate">{log.filename}</td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            log.type === "commerceml" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                          }`}>
                            {log.type === "commerceml" ? "XML" : "CSV"}
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                            log.status === "success" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {log.status === "success" ? "Успішно" : "Частково"}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-green-600">{log.created}</td>
                        <td className="py-2 pr-4 text-blue-600">{log.updated}</td>
                        <td className="py-2 pr-4 text-red-600">{log.errors}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* CSV template */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Шаблон CSV для імпорту</h2>
            <div className="bg-gray-900 rounded-lg p-4 text-green-400 text-sm font-mono overflow-x-auto">
              <p>Артикул;Назва;Ціна;Залишок;Категорія;Опис</p>
              <p>DR-001;Дриль Makita HP1630;3250;15;Дрилі та перфоратори;Ударний дриль 710Вт</p>
              <p>GR-001;Болгарка Bosch GWS 750;2890;8;Шліфувальні машини;Кутова шліфмашина 125мм</p>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Роздільник — крапка з комою (;). Кодування — UTF-8. Підтримуються назви колонок українською та англійською.
            </p>
          </div>
        </div>
      )}

      {activeTab === "export" && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Вивантаження даних для 1С</h2>

            {/* Export type */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Що вивантажити:</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setExportType("orders")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    exportType === "orders"
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  Замовлення
                </button>
                <button
                  onClick={() => setExportType("products")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    exportType === "products"
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  Товари
                </button>
              </div>
            </div>

            {/* Format */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Формат:</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setExportFormat("xml")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    exportFormat === "xml"
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  XML (CommerceML)
                </button>
                <button
                  onClick={() => setExportFormat("csv")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
                    exportFormat === "csv"
                      ? "border-orange-500 bg-orange-50 text-orange-700"
                      : "border-gray-300 text-gray-600 hover:border-gray-400"
                  }`}
                >
                  CSV
                </button>
              </div>
            </div>

            {/* Filters for orders */}
            {exportType === "orders" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Статус</label>
                  <select
                    value={exportStatus}
                    onChange={(e) => setExportStatus(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Усі статуси</option>
                    <option value="PENDING">Очікує оплати</option>
                    <option value="PAID">Оплачено</option>
                    <option value="PACKAGING">На упакуванні</option>
                    <option value="IN_TRANSIT">В дорозі</option>
                    <option value="DELIVERED">Доставлено</option>
                    <option value="CANCELLED">Скасовано</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Від</label>
                  <input
                    type="date"
                    value={exportFrom}
                    onChange={(e) => setExportFrom(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">До</label>
                  <input
                    type="date"
                    value={exportTo}
                    onChange={(e) => setExportTo(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleExport}
              disabled={exporting}
              className="bg-orange-600 text-white px-6 py-2.5 rounded-lg hover:bg-orange-500 transition disabled:opacity-50 font-medium flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              {exporting ? "Вивантажується..." : "Вивантажити"}
            </button>
          </div>

          {/* Info block */}
          <div className="bg-white rounded-xl shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Інструкція з інтеграції з 1С</h2>
            <div className="space-y-4 text-sm text-gray-700">
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Імпорт товарів з 1С → Budvik</h3>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>В 1С виконайте вигрузку товарів у форматі CommerceML (XML) або CSV</li>
                  <li>Перейдіть на вкладку &quot;Імпорт&quot; та завантажте файл</li>
                  <li>Товари зіставляються за артикулом (SKU). Існуючі оновлюються, нові — створюються</li>
                </ol>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">Експорт замовлень Budvik → 1С</h3>
                <ol className="list-decimal ml-4 space-y-1">
                  <li>Оберіть &quot;Замовлення&quot; та потрібний формат (XML/CSV)</li>
                  <li>Відфільтруйте за статусом та датою при потребі</li>
                  <li>Завантажте файл та імпортуйте в 1С через обробку завантаження</li>
                </ol>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-1">API для автоматичного обміну</h3>
                <div className="bg-gray-100 rounded-lg p-3 font-mono text-xs">
                  <p className="text-gray-500 mb-1"># Імпорт товарів (POST multipart/form-data)</p>
                  <p>POST /api/admin/import</p>
                  <p className="text-gray-500 mt-2 mb-1"># Експорт замовлень (GET)</p>
                  <p>GET /api/admin/export?format=xml&amp;status=PAID&amp;from=2026-01-01</p>
                  <p className="text-gray-500 mt-2 mb-1"># Експорт товарів (POST)</p>
                  <p>POST /api/admin/export {"{"}&quot;format&quot;:&quot;csv&quot;{"}"}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
