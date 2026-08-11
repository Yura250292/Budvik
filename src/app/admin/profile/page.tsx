"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { Avatar } from "@/components/ui/Avatar";
import { ROLE_LABELS, ROLE_COLORS } from "@/lib/roles";
import type { Role } from "@prisma/client";

/**
 * Профіль співробітника в десктопній адмінці.
 *
 * Раніше «Мій профіль» у шапці вів на /sales/profile — сторінку, зверстану
 * під телефон (maxWidth 480px, нижній таббар) і з жорстким підписом
 * «Торговий представник». Адмін на широкому екрані бачив мобільний макет і
 * чужу роль. Тут той самий набір дій, але в сітці адмінки й з реальною роллю
 * з /api/account/profile.
 *
 * Логіка навмисно повторює sales/profile, а не виноситься в спільний
 * компонент: макети розходяться (одна колонка проти двох), а обидві сторінки
 * маленькі — спільна абстракція тут коштувала б дорожче за дублювання.
 */

type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  telegramUsername: string | null;
  hasPassword: boolean;
  avatarUrl: string | null;
  color: string | null;
  createdAt: string | null;
};

const CARD = "rounded-[var(--radius-card)] border border-g200 bg-white p-5";
const LABEL = "mb-1.5 block text-[13px] font-semibold text-bk";
const INPUT =
  "w-full rounded-[var(--radius-btn)] border border-g200 px-3.5 py-2.5 text-[14px] text-bk outline-none transition-colors focus:border-bk";
const INPUT_OFF = `${INPUT} bg-g50 text-g500`;

export default function AdminProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dataSaving, setDataSaving] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataDone, setDataDone] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [show, setShow] = useState(false);
  const [passSaving, setPassSaving] = useState(false);
  const [passError, setPassError] = useState<string | null>(null);
  const [passDone, setPassDone] = useState(false);

  const load = () =>
    fetch("/api/account/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Profile | null) => {
        if (!d) return;
        setProfile(d);
        setEmail(d.email);
        setPhone(d.phone ?? "");
      })
      .catch(() => {});

  useEffect(() => {
    load();
  }, []);

  const uploadPhoto = async (file: File) => {
    setPhotoError(null);
    setPhotoBusy(true);

    const fd = new FormData();
    fd.append("file", file);

    // Content-Type не задаємо вручну: браузер сам додає boundary до
    // multipart/form-data, а заданий рядком заголовок його загубить —
    // сервер відповість «no boundary found in multipart body».
    const res = await fetch("/api/account/avatar", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setPhotoBusy(false);

    // Скидаємо завжди: інакше повторний вибір того самого файлу не викличе
    // onChange, і здаватиметься, що кнопка не працює.
    if (fileInput.current) fileInput.current.value = "";

    if (!res.ok) {
      setPhotoError(data.error || "Не вдалося завантажити фото");
      return;
    }
    await load();
  };

  const removePhoto = async () => {
    setPhotoError(null);
    setPhotoBusy(true);
    await fetch("/api/account/avatar", { method: "DELETE" });
    setPhotoBusy(false);
    await load();
  };

  const saveData = async () => {
    setDataError(null);
    setDataDone(false);
    setDataSaving(true);

    const res = await fetch("/api/account/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), phone: phone.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    setDataSaving(false);

    if (!res.ok) {
      setDataError(data.error || "Не вдалося зберегти");
      return;
    }
    setDataDone(true);
    await load();
  };

  const savePassword = async () => {
    setPassError(null);
    setPassDone(false);

    // Повтор — щоб не зберегти пароль з одруківкою і не втратити вхід.
    if (next !== repeat) {
      setPassError("Новий пароль і його повтор не збігаються");
      return;
    }

    setPassSaving(true);
    const res = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    const data = await res.json().catch(() => ({}));
    setPassSaving(false);

    if (!res.ok) {
      setPassError(data.error || "Не вдалося змінити пароль");
      return;
    }

    setPassDone(true);
    setCurrent("");
    setNext("");
    setRepeat("");
    setShow(false);
  };

  if (!profile) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-g300 border-t-bk motion-reduce:animate-none" />
      </div>
    );
  }

  const joined = profile.createdAt
    ? new Date(profile.createdAt).toLocaleDateString("uk-UA", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="mx-auto w-full max-w-[1100px]">
      {/* Дві колонки з lg: ліворуч картка людини, праворуч форми. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {/* === КАРТКА === */}
        <div className={`${CARD} lg:sticky lg:top-4`}>
          <div className="flex flex-col items-center text-center">
            <Avatar
              name={profile.name}
              id={profile.id}
              src={profile.avatarUrl}
              color={profile.color}
              size={96}
            />

            <p className="mt-3 w-full truncate text-[17px] font-bold text-bk">{profile.name}</p>

            <span
              className={`mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${
                ROLE_COLORS[profile.role] ?? "bg-g100 text-g600"
              }`}
            >
              {ROLE_LABELS[profile.role] ?? profile.role}
            </span>

            <p className="mt-2 w-full truncate text-[13px] text-g500">{profile.email}</p>
            {joined && <p className="mt-0.5 text-[12px] text-g400">В системі з {joined}</p>}

            <div className="mt-4 flex w-full flex-col gap-2">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={photoBusy}
                className="min-h-10 rounded-[var(--radius-btn)] bg-primary text-[13px] font-semibold text-bk transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {photoBusy ? "Завантажую..." : profile.avatarUrl ? "Змінити фото" : "Додати фото"}
              </button>

              {profile.avatarUrl && (
                <button
                  type="button"
                  onClick={removePhoto}
                  disabled={photoBusy}
                  className="min-h-10 rounded-[var(--radius-btn)] border border-g200 text-[13px] font-semibold text-red-600 transition-colors hover:bg-g50 disabled:opacity-50"
                >
                  Прибрати фото
                </button>
              )}
            </div>

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
              }}
            />

            {photoError && (
              <p className="mt-3 text-[13px] font-medium text-red-600">{photoError}</p>
            )}
          </div>
        </div>

        {/* === ФОРМИ === */}
        <div className="flex flex-col gap-4">
          <div className={CARD}>
            <h2 className="mb-4 text-[16px] font-bold text-bk">Мої дані</h2>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={LABEL} htmlFor="p-name">
                  Ім&apos;я
                </label>
                <input id="p-name" value={profile.name} disabled className={INPUT_OFF} />
                <p className="mt-1.5 text-[12px] leading-relaxed text-g400">
                  Ім&apos;я змінює адміністратор у розділі «Користувачі»: за ним синхронізація
                  прив&apos;язує документи з 1С.
                </p>
              </div>

              <div>
                <label className={LABEL} htmlFor="p-email">
                  Email для входу
                </label>
                <input
                  id="p-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={INPUT}
                />
              </div>

              <div>
                <label className={LABEL} htmlFor="p-phone">
                  Телефон
                </label>
                <input
                  id="p-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveData()}
                  placeholder="+380..."
                  autoComplete="tel"
                  className={INPUT}
                />
              </div>

              {profile.telegramUsername && (
                <div className="sm:col-span-2">
                  <label className={LABEL} htmlFor="p-tg">
                    Telegram
                  </label>
                  <input
                    id="p-tg"
                    value={`@${profile.telegramUsername}`}
                    disabled
                    className={INPUT_OFF}
                  />
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={saveData}
                disabled={dataSaving}
                className="min-h-10 rounded-[var(--radius-btn)] bg-primary px-5 text-[14px] font-bold text-bk transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {dataSaving ? "Зберігаю..." : "Зберегти дані"}
              </button>

              {dataError && <p className="text-[13px] font-medium text-red-600">{dataError}</p>}
              {dataDone && <p className="text-[13px] font-medium text-green-600">Дані збережено</p>}
            </div>
          </div>

          {/* === ПАРОЛЬ === */}
          <div className={CARD} id="password">
            <h2 className="text-[16px] font-bold text-bk">Пароль</h2>
            <p className="mb-4 mt-0.5 text-[13px] text-g500">
              {profile.hasPassword
                ? "Радимо замінити виданий адміністратором пароль на власний"
                : "У вас немає пароля — зверніться до адміністратора"}
            </p>

            {profile.hasPassword && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <div>
                    <label className={LABEL} htmlFor="p-cur">
                      Поточний пароль
                    </label>
                    <input
                      id="p-cur"
                      type={show ? "text" : "password"}
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      autoComplete="current-password"
                      className={INPUT}
                    />
                  </div>

                  <div>
                    <label className={LABEL} htmlFor="p-new">
                      Новий пароль
                    </label>
                    <input
                      id="p-new"
                      type={show ? "text" : "password"}
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                      placeholder="мінімум 6 символів"
                      autoComplete="new-password"
                      className={INPUT}
                    />
                  </div>

                  <div>
                    <label className={LABEL} htmlFor="p-rep">
                      Повторіть новий
                    </label>
                    <input
                      id="p-rep"
                      type={show ? "text" : "password"}
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && savePassword()}
                      autoComplete="new-password"
                      className={INPUT}
                    />
                  </div>
                </div>

                <label className="mt-3 flex w-fit items-center gap-2 text-[13px] text-g500">
                  <input
                    type="checkbox"
                    checked={show}
                    onChange={(e) => setShow(e.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Показати паролі
                </label>

                <div className="mt-4 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={savePassword}
                    disabled={passSaving || !current || !next || !repeat}
                    className="min-h-10 rounded-[var(--radius-btn)] bg-bk px-5 text-[14px] font-bold text-primary transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    {passSaving ? "Зберігаю..." : "Змінити пароль"}
                  </button>

                  {passError && <p className="text-[13px] font-medium text-red-600">{passError}</p>}
                  {passDone && <p className="text-[13px] font-medium text-green-600">Пароль змінено</p>}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              className="min-h-10 rounded-[var(--radius-btn)] border border-g200 bg-white px-5 text-[14px] font-semibold text-red-600 transition-colors hover:bg-g50"
            >
              Вийти з акаунту
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
