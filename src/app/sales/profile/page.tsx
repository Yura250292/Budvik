"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { Avatar } from "@/components/ui/Avatar";
import { useIsNativeApp } from "@/lib/useIsNativeApp";
import { Body, Button, Card, CardTitle, Note, Page } from "@/components/cabinet/ui";

/** Поле форми в мові кабінету. 16px — інакше iOS зумить сторінку при фокусі. */
const FIELD =
  "w-full rounded-xl border border-cab-line bg-white px-3.5 py-3 text-base text-bk disabled:bg-cab-bg disabled:text-cab-t2";
const LABEL = "mb-1.5 block text-[13px] font-semibold text-bk";

/**
 * Профіль торгового: свої дані і зміна пароля.
 *
 * Стартовий пароль видає адмін через /admin/sales-reps/[id] → «Доступ».
 * Без цієї сторінки виданий пароль лишався б у людини назавжди, а телефон
 * міг виправити тільки адмін.
 *
 * Ім'я показане, але заблоковане: за ним синхронізація прив'язує документи
 * з 1С — детальніше в api/account/profile/route.ts.
 */

type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  telegramUsername: string | null;
  hasPassword: boolean;
  avatarUrl: string | null;
  color: string | null;
};

export default function SalesProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const isApp = useIsNativeApp();

  // Дані
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dataSaving, setDataSaving] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [dataDone, setDataDone] = useState(false);

  // Фото
  const fileInput = useRef<HTMLInputElement>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Пароль
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
    const res = await fetch("/api/account/avatar", { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setPhotoBusy(false);

    // Поле скидаємо завжди: інакше повторний вибір того самого файлу
    // не викличе onChange, і людина подумає, що кнопка не працює.
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
    const data = await res.json();
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

    // Другий раз — щоб не зберегти пароль з одруківкою і не втратити вхід.
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
    const data = await res.json();
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

  return (
    <>
      <SalesHeader title="Профіль" subtitle={profile?.name} backTo="/sales" showProfile={false} />

      <Page>
        {!profile ? (
          <Card>
            <Body>Завантаження…</Body>
          </Card>
        ) : (
          <>
            {/* === ФОТО === */}
            <Card className="flex flex-col gap-3">
              <div className="flex items-center gap-4">
                <Avatar
                  name={profile.name}
                  id={profile.id}
                  src={profile.avatarUrl}
                  color={profile.color}
                  size={72}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-bold text-bk">{profile.name}</p>
                  <p className="mb-2.5 text-[13px] text-cab-t2">Торговий представник</p>

                  <div className="flex gap-2">
                    <Button tone="brand" small onClick={() => fileInput.current?.click()} disabled={photoBusy}>
                      {photoBusy ? "Вантажу…" : profile.avatarUrl ? "Змінити фото" : "Додати фото"}
                    </Button>
                    {!!profile.avatarUrl && (
                      <button
                        onClick={removePhoto}
                        disabled={photoBusy}
                        className="h-11 rounded-xl border border-bad-line bg-white px-3.5 text-[13px] font-semibold text-bad disabled:opacity-50"
                      >
                        Прибрати
                      </button>
                    )}
                  </div>
                </div>
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

              {!!photoError && <Note tone="bad">{photoError}</Note>}
            </Card>

            {/* === ДАНІ === */}
            <Card className="flex flex-col gap-4">
              <CardTitle big>Мої дані</CardTitle>

              <div>
                <label className={LABEL}>Ім&apos;я</label>
                <input value={profile.name} disabled className={FIELD} />
                <Note>Ім&apos;я змінює адміністратор: за ним підтягуються ваші продажі з 1С.</Note>
              </div>

              <div>
                <label className={LABEL}>Email для входу</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className={FIELD}
                />
              </div>

              <div>
                <label className={LABEL}>Телефон</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+380..."
                  autoComplete="tel"
                  onKeyDown={(e) => e.key === "Enter" && saveData()}
                  className={FIELD}
                />
              </div>

              {!!profile.telegramUsername && (
                <div>
                  <label className={LABEL}>Telegram</label>
                  <input value={`@${profile.telegramUsername}`} disabled className={FIELD} />
                </div>
              )}

              {!!dataError && <p className="text-sm font-medium text-bad-fg">{dataError}</p>}
              {dataDone && <p className="text-sm font-medium text-ok-fg">Дані збережено</p>}

              <Button tone="brand" onClick={saveData} disabled={dataSaving} className="w-full">
                {dataSaving ? "Зберігаю…" : "Зберегти дані"}
              </Button>
            </Card>

            {/* === ПАРОЛЬ === */}
            <Card className="flex flex-col gap-4">
              <div>
                <CardTitle big>Пароль</CardTitle>
                <Note>
                  {profile.hasPassword
                    ? "Радимо замінити пароль, який видав адміністратор, на власний"
                    : "У вас немає пароля — зверніться до адміністратора"}
                </Note>
              </div>

              {profile.hasPassword && (
                <>
                  <div>
                    <label className={LABEL}>Поточний пароль</label>
                    <input
                      type={show ? "text" : "password"}
                      value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      autoComplete="current-password"
                      className={FIELD}
                    />
                  </div>

                  <div>
                    <label className={LABEL}>Новий пароль</label>
                    <input
                      type={show ? "text" : "password"}
                      value={next}
                      onChange={(e) => setNext(e.target.value)}
                      placeholder="мінімум 6 символів"
                      autoComplete="new-password"
                      className={FIELD}
                    />
                  </div>

                  <div>
                    <label className={LABEL}>Повторіть новий</label>
                    <input
                      type={show ? "text" : "password"}
                      value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && savePassword()}
                      autoComplete="new-password"
                      className={FIELD}
                    />
                  </div>

                  <label className="flex items-center gap-2 text-sm text-cab-t2">
                    <input
                      type="checkbox"
                      checked={show}
                      onChange={(e) => setShow(e.target.checked)}
                      className="h-[18px] w-[18px] accent-primary"
                    />
                    Показати паролі
                  </label>

                  {!!passError && <p className="text-sm font-medium text-bad-fg">{passError}</p>}
                  {passDone && <p className="text-sm font-medium text-ok-fg">Пароль змінено</p>}

                  <Button
                    tone="dark"
                    onClick={savePassword}
                    disabled={passSaving || !current || !next || !repeat}
                    className="w-full"
                  >
                    {passSaving ? "Зберігаю…" : "Змінити пароль"}
                  </Button>
                </>
              )}
            </Card>

            {/* === ВИХІД ===
                У застосунку виходить натив: signOut прибрав би кукі, але
                лишив токен пристрою, і трек писався б далі. */}
            <button
              onClick={() => (isApp ? window.BudvikApp?.logout() : signOut({ callbackUrl: "/" }))}
              className="min-h-12 w-full rounded-2xl border border-bad-line bg-white text-[15px] font-semibold text-bad"
            >
              Вийти з акаунту
            </button>
          </>
        )}
      </Page>
    </>
  );
}
