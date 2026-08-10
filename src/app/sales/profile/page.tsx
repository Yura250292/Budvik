"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { SalesHeader } from "@/components/sales/SalesHeader";
import { Avatar } from "@/components/ui/Avatar";

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

const inputStyle = {
  width: "100%",
  padding: "12px 14px",
  borderRadius: "12px",
  border: "1px solid #E5E7EB",
  fontSize: "16px", // 16px — щоб iOS не зумив форму при фокусі
} as const;

const labelStyle = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  marginBottom: "6px",
} as const;

const cardStyle = {
  border: "1px solid #EFEFEF",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
} as const;

export default function SalesProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);

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
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <SalesHeader title="Профіль" subtitle={profile?.name} backTo="/sales" showProfile={false} />

      <div className="mx-auto px-4" style={{ maxWidth: "480px", paddingTop: "20px", paddingBottom: "40px" }}>
        {!profile ? (
          <p style={{ textAlign: "center", color: "#9CA3AF", padding: "40px 0" }}>Завантаження...</p>
        ) : (
          <div className="space-y-4">
            {/* === ФОТО === */}
            <div className="bg-white rounded-2xl p-5" style={cardStyle}>
              <div className="flex items-center gap-4">
                <Avatar name={profile.name} id={profile.id} src={profile.avatarUrl}
                  color={profile.color} size={72} />

                <div className="flex-1 min-w-0">
                  <p style={{ fontSize: "16px", fontWeight: 700, color: "#0A0A0A" }} className="truncate">
                    {profile.name}
                  </p>
                  <p style={{ fontSize: "13px", color: "#6B7280", marginBottom: "10px" }}>
                    Торговий представник
                  </p>

                  <div className="flex gap-2">
                    <button onClick={() => fileInput.current?.click()} disabled={photoBusy}
                      style={{
                        padding: "8px 14px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                        background: "#FFD600", color: "#0A0A0A", border: "none", opacity: photoBusy ? 0.5 : 1,
                      }}>
                      {photoBusy ? "..." : profile.avatarUrl ? "Змінити фото" : "Додати фото"}
                    </button>
                    {profile.avatarUrl && (
                      <button onClick={removePhoto} disabled={photoBusy}
                        style={{
                          padding: "8px 14px", borderRadius: "10px", fontSize: "13px", fontWeight: 600,
                          background: "white", color: "#DC2626", border: "1px solid #FECACA",
                        }}>
                        Прибрати
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <input ref={fileInput} type="file" accept="image/*" hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f);
                }} />

              {photoError && (
                <p style={{ fontSize: "13px", color: "#DC2626", fontWeight: 500, marginTop: "12px" }}>{photoError}</p>
              )}
            </div>

            {/* === ДАНІ === */}
            <div className="bg-white rounded-2xl p-5" style={cardStyle}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "16px" }}>Мої дані</h2>

              <div className="space-y-4">
                <div>
                  <label style={labelStyle}>Ім'я</label>
                  <input value={profile.name} disabled
                    style={{ ...inputStyle, background: "#F9FAFB", color: "#6B7280" }} />
                  <p style={{ fontSize: "12px", color: "#9CA3AF", marginTop: "6px", lineHeight: 1.5 }}>
                    Ім'я змінює адміністратор: за ним підтягуються ваші продажі з 1С.
                  </p>
                </div>

                <div>
                  <label style={labelStyle}>Email для входу</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email" style={inputStyle} />
                </div>

                <div>
                  <label style={labelStyle}>Телефон</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                    placeholder="+380..." autoComplete="tel"
                    onKeyDown={(e) => e.key === "Enter" && saveData()}
                    style={inputStyle} />
                </div>

                {profile.telegramUsername && (
                  <div>
                    <label style={labelStyle}>Telegram</label>
                    <input value={`@${profile.telegramUsername}`} disabled
                      style={{ ...inputStyle, background: "#F9FAFB", color: "#6B7280" }} />
                  </div>
                )}

                {dataError && <p style={{ fontSize: "14px", color: "#DC2626", fontWeight: 500 }}>{dataError}</p>}
                {dataDone && <p style={{ fontSize: "14px", color: "#16A34A", fontWeight: 500 }}>Дані збережено</p>}

                <button onClick={saveData} disabled={dataSaving}
                  style={{
                    width: "100%", padding: "14px", borderRadius: "12px", fontWeight: 700, fontSize: "15px",
                    background: "#FFD600", color: "#0A0A0A", border: "none", opacity: dataSaving ? 0.4 : 1,
                  }}>
                  {dataSaving ? "Зберігаю..." : "Зберегти дані"}
                </button>
              </div>
            </div>

            {/* === ПАРОЛЬ === */}
            <div className="bg-white rounded-2xl p-5" style={cardStyle}>
              <h2 style={{ fontSize: "16px", fontWeight: 700, marginBottom: "4px" }}>Пароль</h2>
              <p style={{ fontSize: "13px", color: "#9CA3AF", marginBottom: "16px" }}>
                {profile.hasPassword
                  ? "Радимо замінити пароль, який видав адміністратор, на власний"
                  : "У вас немає пароля — зверніться до адміністратора"}
              </p>

              {profile.hasPassword && (
                <div className="space-y-4">
                  <div>
                    <label style={labelStyle}>Поточний пароль</label>
                    <input type={show ? "text" : "password"} value={current}
                      onChange={(e) => setCurrent(e.target.value)}
                      autoComplete="current-password" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Новий пароль</label>
                    <input type={show ? "text" : "password"} value={next}
                      onChange={(e) => setNext(e.target.value)}
                      placeholder="мінімум 6 символів"
                      autoComplete="new-password" style={inputStyle} />
                  </div>

                  <div>
                    <label style={labelStyle}>Повторіть новий</label>
                    <input type={show ? "text" : "password"} value={repeat}
                      onChange={(e) => setRepeat(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && savePassword()}
                      autoComplete="new-password" style={inputStyle} />
                  </div>

                  <label className="flex items-center gap-2" style={{ fontSize: "14px", color: "#6B7280" }}>
                    <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)}
                      style={{ width: "18px", height: "18px", accentColor: "#FFD600" }} />
                    Показати паролі
                  </label>

                  {passError && <p style={{ fontSize: "14px", color: "#DC2626", fontWeight: 500 }}>{passError}</p>}
                  {passDone && <p style={{ fontSize: "14px", color: "#16A34A", fontWeight: 500 }}>Пароль змінено</p>}

                  <button onClick={savePassword} disabled={passSaving || !current || !next || !repeat}
                    style={{
                      width: "100%", padding: "14px", borderRadius: "12px", fontWeight: 700, fontSize: "15px",
                      background: "#0A0A0A", color: "#FFD600", border: "none",
                      opacity: passSaving || !current || !next || !repeat ? 0.4 : 1,
                    }}>
                    {passSaving ? "Зберігаю..." : "Змінити пароль"}
                  </button>
                </div>
              )}
            </div>

            {/* === ВИХІД === */}
            <button onClick={() => signOut({ callbackUrl: "/" })}
              style={{
                width: "100%", padding: "14px", borderRadius: "12px", fontWeight: 600, fontSize: "15px",
                background: "white", color: "#DC2626", border: "1px solid #FECACA",
              }}>
              Вийти з акаунту
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
