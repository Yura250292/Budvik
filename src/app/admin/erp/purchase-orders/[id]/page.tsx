"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { formatPrice, formatDate, formatDocDate } from "@/lib/utils";
import { TableScroll } from "@/components/ui/TableScroll";

/**
 * Картка прихідної накладної.
 *
 * Документ із 1С (externalId заповнений) — лише для перегляду: проводить,
 * змінює і скасовує його 1С, а обмін привозить результат наступним циклом.
 * Кнопки для нього приховані, і сервер відмовляє теж (роут PATCH віддає 409),
 * щоб правка не встигла розійтися з обліком між двома циклами обміну.
 *
 * Ручні накладні лишаються для випадків поза 1С. Залишок вони НЕ рухають:
 * Product.stock рахується з регістру 1С і перезаписується щоп'ять хвилин.
 */

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Чернетка",
  CONFIRMED: "Підтверджено",
  CANCELLED: "Скасовано",
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-g100 text-g600",
  CONFIRMED: "bg-green-50 text-green-700",
  CANCELLED: "bg-red-50 text-red-600",
};

export default function PurchaseOrderDetailPage() {
  const { data: session } = useSession();
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const isNew = id === "new";

  const [order, setOrder] = useState<any>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);

  // Form state
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<{
    productId: string;
    productName: string;
    sku: string;
    slug?: string | null;
    brand?: string | null;
    image?: string | null;
    lineNo?: number | null;
    quantity: number;
    purchasePrice: number;
  }[]>([]);

  // Lookups
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState<any[]>([]);
  const [searchingProducts, setSearchingProducts] = useState(false);

  const role = (session?.user as any)?.role;

  // Load suppliers
  useEffect(() => {
    fetch("/api/erp/counterparties?type=SUPPLIER")
      .then((r) => r.json())
      .then((data) => {
        // Also include BOTH type
        fetch("/api/erp/counterparties?type=BOTH")
          .then((r) => r.json())
          .then((both) => {
            const all = [...(Array.isArray(data) ? data : []), ...(Array.isArray(both) ? both : [])];
            const unique = all.filter((v, i, a) => a.findIndex((t) => t.id === v.id) === i);
            setSuppliers(unique);
          });
      });
  }, []);

  // Load existing order
  const fetchOrder = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    const res = await fetch(`/api/erp/purchase-orders/${id}`);
    if (res.ok) {
      const data = await res.json();
      setOrder(data);
      setSupplierId(data.supplierId);
      setNotes(data.notes || "");
      setItems(
        data.items.map((i: any) => ({
          productId: i.productId,
          productName: i.product?.name || "",
          sku: i.product?.sku || "",
          slug: i.product?.slug ?? null,
          brand: i.product?.brand?.name ?? null,
          image: i.product?.image ?? null,
          lineNo: i.lineNo ?? null,
          quantity: i.quantity,
          purchasePrice: i.purchasePrice,
        }))
      );
    }
    setLoading(false);
  }, [id, isNew]);

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  // Product search
  const searchProducts = async (query: string) => {
    setProductSearch(query);
    if (query.length < 2) {
      setProductResults([]);
      return;
    }
    setSearchingProducts(true);
    const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&limit=10`);
    const data = await res.json();
    setProductResults(data.products || data || []);
    setSearchingProducts(false);
  };

  const addProduct = (product: any) => {
    if (items.some((i) => i.productId === product.id)) {
      setItems(items.map((i) => (i.productId === product.id ? { ...i, quantity: i.quantity + 1 } : i)));
    } else {
      setItems([
        ...items,
        {
          productId: product.id,
          productName: product.name,
          sku: product.sku || "",
          quantity: 1,
          purchasePrice: 0,
        },
      ]);
    }
    setProductSearch("");
    setProductResults([]);
  };

  const updateItem = (index: number, field: string, value: number) => {
    setItems(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const totalAmount = items.reduce((sum, i) => sum + i.quantity * i.purchasePrice, 0);

  const handleSave = async () => {
    if (!supplierId) return alert("Оберіть постачальника");
    if (items.length === 0) return alert("Додайте товари");
    if (items.some((i) => i.purchasePrice <= 0)) return alert("Вкажіть ціну для всіх товарів");

    setSaving(true);
    const payload = {
      supplierId,
      notes,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        purchasePrice: i.purchasePrice,
      })),
    };

    const url = isNew ? "/api/erp/purchase-orders" : `/api/erp/purchase-orders/${id}`;
    const method = isNew ? "POST" : "PATCH";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      if (isNew) {
        router.push(`/admin/erp/purchase-orders/${data.id}`);
      } else {
        fetchOrder();
      }
    } else {
      const err = await res.json();
      alert(err.error || "Помилка збереження");
    }
    setSaving(false);
  };

  const handleConfirm = async () => {
    // Про залишки тут навмисно нічого не обіцяємо: їх веде 1С, а проведення
    // сайтового документа лише фіксує статус і ціну постачальника.
    if (!confirm("Підтвердити прихід? Залишки веде 1С — вони не зміняться.")) return;
    setSaving(true);
    const res = await fetch(`/api/erp/purchase-orders/${id}/confirm`, { method: "POST" });
    if (res.ok) {
      fetchOrder();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка");
    }
    setSaving(false);
  };

  const handleCancel = async () => {
    if (!confirm("Скасувати накладну?")) return;
    setSaving(true);
    const res = await fetch(`/api/erp/purchase-orders/${id}/cancel`, { method: "POST" });
    if (res.ok) {
      fetchOrder();
    } else {
      const err = await res.json();
      alert(err.error || "Помилка");
    }
    setSaving(false);
  };

  if (role !== "ADMIN" && role !== "MANAGER") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center"><h1 className="text-2xl font-bold">Доступ заборонено</h1></div>;
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center" style={{ color: "#9E9E9E" }}>Завантаження...</div>;
  }

  // Дзеркало картки продажу: DRAFT з 1С — це непроведений документ обліку,
  // а не наша чернетка, і редагувати його на сайті не можна.
  const isOneC = !!order?.externalId;
  const isDraft = isNew || (order?.status === "DRAFT" && !isOneC);
  // Номер рядка показуємо лише там, де він щось означає, — у документах 1С.
  const showLineNo = isOneC;

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin/erp/purchase-orders" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>
                {isNew ? "Нова прихідна накладна" : `${order?.number}`}
              </h1>
              {order && (
                <div className="flex items-center gap-2 mt-1">
                  <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${STATUS_COLORS[order.status]}`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                  {/* Документ 1С — у UTC, щоб час збігався з екраном 1С посимвольно. */}
                  <span style={{ fontSize: "13px", color: "#9CA3AF" }}>
                    {order.externalId ? formatDocDate(order.createdAt) : formatDate(order.createdAt)}
                  </span>
                  {isOneC && (
                    <span className="rounded-md px-2 py-0.5 text-xs font-medium" style={{ background: "#EFF6FF", color: "#2563EB" }}>
                      З 1С
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isDraft && (
              <>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={{ background: "#FFD600", color: "#0A0A0A", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: saving ? 0.6 : 1 }}
                >
                  {saving ? "..." : isNew ? "Створити" : "Зберегти"}
                </button>
                {!isNew && (
                  <button
                    onClick={handleConfirm}
                    disabled={saving}
                    style={{ background: "#22C55E", color: "white", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", opacity: saving ? 0.6 : 1 }}
                  >
                    Підтвердити
                  </button>
                )}
              </>
            )}
            {order && !isOneC && order.status !== "CANCELLED" && (
              <button
                onClick={handleCancel}
                disabled={saving}
                style={{ background: "white", color: "#EF4444", padding: "10px 20px", borderRadius: "8px", fontWeight: 600, fontSize: "14px", border: "1px solid #FCA5A5", opacity: saving ? 0.6 : 1 }}
              >
                Скасувати
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {isOneC && (
          <div className="mb-6 rounded-xl p-4 text-sm" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE", color: "#1E40AF" }}>
            Документ надходження з 1С. Тут він лише для перегляду: номер, склад,
            позиції та суми змінює 1С, а обмін привозить зміни протягом циклу.
            {order?.stockLocation?.name && <> Склад: <b>{order.stockLocation.name}</b>.</>}
            {order?.currencyCode && (
              <> Документ у валюті <b>{order.currencyCode}</b>
                {order.currencyRate ? <> за курсом {order.currencyRate.toLocaleString("uk-UA", { maximumFractionDigits: 4 })}</> : null}
                {" "}— суми показані в гривні.
              </>
            )}
            {order?.syncedAt && (
              <span style={{ color: "#3B82F6" }}> Останнє оновлення з 1С: {formatDate(order.syncedAt)}.</span>
            )}
          </div>
        )}

        {/* Supplier & Notes */}
        <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">
                Постачальник{isDraft ? " *" : ""}
              </label>
              {isDraft ? (
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                >
                  <option value="">Оберіть постачальника...</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}{s.code ? ` (${s.code})` : ""}</option>
                  ))}
                </select>
              ) : order?.supplier ? (
                <p style={{ fontSize: "14px", fontWeight: 500, padding: "10px 0" }}>
                  <Link
                    href={`/admin/erp/purchase-orders?supplierId=${order.supplier.id}`}
                    className="text-blue-600 hover:text-blue-800"
                    title="Усі надходження від цього постачальника"
                  >
                    {order.supplier.name}
                  </Link>
                </p>
              ) : (
                <p style={{ fontSize: "14px", padding: "10px 0", color: "#9CA3AF" }}>—</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-g600 mb-1">Примітки</label>
              {isDraft ? (
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Необов'язково"
                  style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
                />
              ) : (
                <p style={{ fontSize: "14px", color: "#6B7280", padding: "10px 0" }}>{order?.notes || "—"}</p>
              )}
            </div>
          </div>
        </div>

        {/* Add product (only for drafts) */}
        {isDraft && (
          <div className="bg-white rounded-xl p-6 mb-6" style={{ border: "1px solid #EFEFEF" }}>
            <label className="block text-sm font-medium text-g600 mb-2">Додати товар</label>
            <div className="relative">
              <input
                value={productSearch}
                onChange={(e) => searchProducts(e.target.value)}
                placeholder="Пошук за назвою або артикулом..."
                style={{ width: "100%", padding: "10px 14px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "14px" }}
              />
              {productResults.length > 0 && (
                <div
                  className="absolute z-10 w-full bg-white border rounded-lg mt-1 max-h-60 overflow-y-auto"
                  style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.12)", border: "1px solid #E5E7EB" }}
                >
                  {productResults.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full text-left px-4 py-3 hover:bg-g50 flex items-center justify-between"
                      style={{ borderBottom: "1px solid #F3F4F6" }}
                    >
                      <div>
                        <span style={{ fontSize: "14px", fontWeight: 500 }}>{p.name}</span>
                        {p.sku && <span style={{ fontSize: "12px", color: "#9CA3AF", marginLeft: "8px" }}>{p.sku}</span>}
                      </div>
                      <span style={{ fontSize: "13px", color: "#6B7280" }}>{formatPrice(p.price)}</span>
                    </button>
                  ))}
                </div>
              )}
              {searchingProducts && (
                <div className="absolute right-3 top-3">
                  <div className="w-5 h-5 border-2 border-g300 border-t-g600 rounded-full animate-spin" />
                </div>
              )}
            </div>
          </div>
        )}

        {/* Items table */}
        <div className="bg-white rounded-xl overflow-hidden" style={{ border: "1px solid #EFEFEF" }}>
          <TableScroll stickyHeader>
            <table className="w-full">
              <thead>
                <tr style={{ background: "#FAFAFA", borderBottom: "1px solid #EFEFEF" }}>
                  {showLineNo && (
                    <th style={{ padding: "12px 8px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280", width: "44px" }}>№</th>
                  )}
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280", width: "40%" }}>Товар</th>
                  <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Артикул</th>
                  <th style={{ padding: "12px 16px", textAlign: "center", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Кількість</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Ціна закупівлі</th>
                  <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "13px", fontWeight: 600, color: "#6B7280" }}>Сума</th>
                  {isDraft && <th style={{ padding: "12px 16px", width: "50px" }} />}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={(isDraft ? 6 : 5) + (showLineNo ? 1 : 0)} style={{ padding: "40px", textAlign: "center", color: "#9CA3AF", fontSize: "14px" }}>
                      {isOneC ? "У документі немає позицій, зіставлених із товарами сайту." : "Немає товарів. Скористайтесь пошуком вище."}
                    </td>
                  </tr>
                ) : (
                  items.map((item, idx) => (
                    <tr key={idx} style={{ borderBottom: "1px solid #F3F4F6" }}>
                      {showLineNo && (
                        <td style={{ padding: "12px 8px", textAlign: "right", fontSize: "13px", color: "#9CA3AF" }}>
                          {item.lineNo ?? idx + 1}
                        </td>
                      )}
                      <td style={{ padding: "12px 16px", fontSize: "14px", fontWeight: 500 }}>
                        <div className="flex items-center gap-3">
                          {item.image && (
                            // Звичайний <img>: домени фото різні (budvik.com,
                            // prom.ua, cdn.27.ua), і оптимізатор робив би зайвий
                            // проксі-запит на кожен рядок накладної.
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image}
                              alt=""
                              style={{ width: 36, height: 36, objectFit: "contain", borderRadius: 6, border: "1px solid #EFEFEF", flexShrink: 0 }}
                            />
                          )}
                          <div className="min-w-0">
                            {item.slug ? (
                              <a
                                href={`/catalog/${item.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-700 hover:underline"
                              >
                                {item.productName}
                              </a>
                            ) : (
                              item.productName
                            )}
                            {item.brand && (
                              <div style={{ fontSize: "12px", color: "#9CA3AF", fontWeight: 400 }}>{item.brand}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: "12px 16px", fontSize: "13px", color: "#6B7280", fontFamily: "monospace" }}>{item.sku || "—"}</td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {isDraft ? (
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) => updateItem(idx, "quantity", Math.max(1, parseInt(e.target.value) || 1))}
                            style={{ width: "80px", padding: "6px 10px", borderRadius: "6px", border: "1px solid #E5E7EB", fontSize: "14px", textAlign: "center" }}
                          />
                        ) : (
                          <span style={{ fontSize: "14px" }}>{item.quantity}</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right" }}>
                        {isDraft ? (
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={item.purchasePrice}
                            onChange={(e) => updateItem(idx, "purchasePrice", Math.max(0, parseFloat(e.target.value) || 0))}
                            style={{ width: "120px", padding: "6px 10px", borderRadius: "6px", border: "1px solid #E5E7EB", fontSize: "14px", textAlign: "right" }}
                          />
                        ) : (
                          <span style={{ fontSize: "14px" }}>{formatPrice(item.purchasePrice)}</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontSize: "14px", fontWeight: 600 }}>
                        {formatPrice(item.quantity * item.purchasePrice)}
                      </td>
                      {isDraft && (
                        <td style={{ padding: "12px 16px" }}>
                          <button
                            onClick={() => removeItem(idx)}
                            className="text-red-400 hover:text-red-600"
                          >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
              {items.length > 0 && (
                <tfoot>
                  <tr style={{ background: "#FAFAFA", borderTop: "2px solid #EFEFEF" }}>
                    {/*
                      Підпис займає всі колонки, крім останньої видимої суми
                      (і крім службової колонки дій у чернетці). Доти тут
                      стояло «3», і в режимі перегляду підсумок з'їжджав на
                      колонку вліво — під «Ціну закупівлі».
                    */}
                    <td colSpan={4 + (showLineNo ? 1 : 0)} style={{ padding: "14px 16px", textAlign: "right", fontSize: "15px", fontWeight: 700 }}>
                      Разом:
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontSize: "18px", fontWeight: 700, color: "#0A0A0A" }}>
                      {/*
                        Для документа 1С сума береться з шапки, а не з рядків:
                        позиції, яких немає в довіднику сайту, до таблиці не
                        потрапляють (вони лишились у журналі розбіжностей), і
                        підсумок по рядках був би меншим за накладну.
                      */}
                      {formatPrice(isOneC ? order?.totalAmount ?? 0 : totalAmount)}
                    </td>
                    {isDraft && <td />}
                  </tr>
                  {isOneC && Math.abs((order?.totalAmount ?? 0) - totalAmount) > 0.01 && (
                    <tr style={{ background: "#FAFAFA" }}>
                      <td colSpan={(isDraft ? 6 : 5) + (showLineNo ? 1 : 0)} style={{ padding: "0 16px 12px", textAlign: "right", fontSize: "12px", color: "#9CA3AF" }}>
                        Сума показаних позицій: {formatPrice(totalAmount)} — решта рядків не зіставлена з товарами сайту.
                      </td>
                    </tr>
                  )}
                </tfoot>
              )}
            </table>
          </TableScroll>
        </div>
      </div>
    </div>
  );
}
