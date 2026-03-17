"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/utils";

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  PRODUCTION: "Виробництво",
  SHOP: "Магазин",
  SUBDISTRIBUTOR: "Субдистриб'ютор",
  MARKET_POINT: "Точка на ринку",
  OTHER: "Інше",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "На розгляді",
  APPROVED: "Затверджено",
  REJECTED: "Відхилено",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-primary/20 text-primary-dark",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

function WholesalePageInner() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const orderedNumber = searchParams.get("ordered");
  const [applications, setApplications] = useState<any[]>([]);
  const [userData, setUserData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [form, setForm] = useState({
    legalName: "",
    contactName: "",
    phone: "",
    email: "",
    address: "",
    businessType: "SHOP",
  });

  useEffect(() => {
    if (!session) return;
    fetch("/api/wholesale/apply")
      .then((r) => r.json())
      .then((data) => {
        setApplications(data.applications || []);
        setUserData(data.user);
        setLoading(false);
      });
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setSubmitting(true);

    const res = await fetch("/api/wholesale/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error || "Помилка при подачі заявки");
      return;
    }

    setSuccess("Заявку подано успішно! Очікуйте на розгляд.");
    setApplications((prev) => [data, ...prev]);
    setForm({ legalName: "", contactName: "", phone: "", email: "", address: "", businessType: "SHOP" });
  };

  if (!session) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-16 text-center">
        <h1 className="text-2xl font-bold mb-4">Увійдіть до свого акаунту</h1>
        <Link href="/login" className="btn-primary inline-block">
          Увійти
        </Link>
      </div>
    );
  }

  const role = (session.user as any).role;
  const hasPending = applications.some((a: any) => a.status === "PENDING");
  const isWholesale = role === "WHOLESALE";

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <Link href="/dashboard" className="text-primary hover:underline text-sm mb-4 inline-block">
        &larr; Назад до кабінету
      </Link>

      {orderedNumber && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-start gap-3">
          <svg className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="font-semibold text-green-900">Замовлення №{orderedNumber} надіслано!</p>
            <p className="text-sm text-green-700 mt-0.5">Ваш торговий менеджер отримав сповіщення і незабаром зв&apos;яжеться з вами.</p>
          </div>
        </div>
      )}

      <h1 className="text-3xl font-bold text-bk mb-2">Оптові замовлення</h1>
      <p className="text-g400 mb-8">
        {isWholesale
          ? "Ви маєте статус оптового покупця з доступом до оптових цін"
          : "Подайте заявку на статус оптового покупця для доступу до спеціальних цін"}
      </p>

      {/* Current wholesale status */}
      {isWholesale && userData?.company && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-green-900">Статус: Оптовик</h3>
              <p className="text-sm text-green-700">Вам доступні оптові ціни</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
            <div>
              <span className="text-green-700 font-medium">Компанія:</span>{" "}
              <span className="text-green-900">{userData.company.legalName}</span>
            </div>
            <div>
              <span className="text-green-700 font-medium">Тип діяльності:</span>{" "}
              <span className="text-green-900">{BUSINESS_TYPE_LABELS[userData.company.businessType]}</span>
            </div>
            <div>
              <span className="text-green-700 font-medium">Адреса:</span>{" "}
              <span className="text-green-900">{userData.company.address}</span>
            </div>
            <div>
              <span className="text-green-700 font-medium">Контактний телефон:</span>{" "}
              <span className="text-green-900">{userData.company.phone}</span>
            </div>
          </div>
          <Link
            href="/catalog"
            className="inline-flex items-center gap-2 bg-green-700 hover:bg-green-800 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Перейти до каталогу (опт ціни)
          </Link>
        </div>
      )}

      {/* Application form - only show if not wholesale and no pending application */}
      {!isWholesale && !hasPending && (
        <div className="bg-white border rounded-xl p-6 mb-8">
          <h2 className="text-xl font-bold text-bk mb-4">Заявка на оптового покупця</h2>
          <p className="text-sm text-g400 mb-6">
            Заповніть форму нижче. Під однією компанією можуть бути кілька менеджерів &mdash;
            рахунок виписується на компанію, а бонус (кешбек) нараховується на конкретного менеджера.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 mb-4 text-sm">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 mb-4 text-sm">
              {success}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-g600 mb-1">
                  Юридична назва компанії / ФОП *
                </label>
                <input
                  type="text"
                  value={form.legalName}
                  onChange={(e) => setForm({ ...form, legalName: e.target.value })}
                  placeholder='ТОВ "Назва" або ФОП Прізвище І.Б.'
                  required
                  className="w-full border border-g300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-g600 mb-1">
                  ПІБ контактної особи *
                </label>
                <input
                  type="text"
                  value={form.contactName}
                  onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  placeholder="Прізвище Ім'я По-батькові"
                  required
                  className="w-full border border-g300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-g600 mb-1">
                  Телефон *
                </label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+380XXXXXXXXX"
                  required
                  className="w-full border border-g300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-g600 mb-1">
                  Email *
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="company@example.com"
                  required
                  className="w-full border border-g300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-g600 mb-1">
                  Адреса доставки *
                </label>
                <input
                  type="text"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="м. Київ, вул. Хрещатик, 1"
                  required
                  className="w-full border border-g300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-g600 mb-1">
                  Вид діяльності *
                </label>
                <select
                  value={form.businessType}
                  onChange={(e) => setForm({ ...form, businessType: e.target.value })}
                  required
                  className="w-full border border-g300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {Object.entries(BUSINESS_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
              Під однією компанією можуть працювати кілька менеджерів. Кожен менеджер може подати
              окрему заявку з тією ж юридичною назвою компанії. Рахунок буде виписаний на компанію,
              а бонуси (кешбек) нараховуються індивідуально кожному менеджеру.
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary disabled:opacity-50"
            >
              {submitting ? "Подання заявки..." : "Подати заявку"}
            </button>
          </form>
        </div>
      )}

      {/* Pending notice */}
      {hasPending && !isWholesale && (
        <div className="bg-primary/10 border border-primary/30 rounded-xl p-6 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary/20 rounded-lg flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary-dark" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-semibold text-primary-dark">Заявка на розгляді</h3>
              <p className="text-sm text-primary-dark">Ваша заявка очікує на підтвердження адміністратором або торговим менеджером</p>
            </div>
          </div>
        </div>
      )}

      {/* Application history */}
      {applications.length > 0 && (
        <div>
          <h2 className="text-xl font-bold text-bk mb-4">Історія заявок</h2>
          <div className="space-y-3">
            {applications.map((app: any) => (
              <div key={app.id} className="bg-white border rounded-lg p-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h4 className="font-semibold text-bk">{app.legalName}</h4>
                    <p className="text-sm text-g400">
                      {app.contactName} &bull; {app.phone} &bull; {BUSINESS_TYPE_LABELS[app.businessType]}
                    </p>
                    <p className="text-xs text-g400 mt-1">{formatDate(app.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[app.status]}`}>
                      {STATUS_LABELS[app.status]}
                    </span>
                  </div>
                </div>
                {app.reviewNote && (
                  <p className="mt-3 text-sm text-g500 bg-g50 rounded p-3">
                    <span className="font-medium">Коментар:</span> {app.reviewNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function WholesalePage() {
  return (
    <Suspense>
      <WholesalePageInner />
    </Suspense>
  );
}
