"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useApi } from "@/components/ui/useApi";
import { ErrorBox } from "@/components/ui/ErrorBox";

/**
 * Коментарі й фото локації клієнта: що торговий знає, чого немає в цифрах.
 *
 * Стрічка з автором і датою, а не одне спільне поле нотаток: інакше
 * останній, хто писав, затирає попереднього, і незрозуміло, чия це
 * домовленість і коли вона була.
 *
 * Фото живе в тій самій стрічці. «Заїзд з двору, ворота зелені» і знімок
 * тих воріт — одне й те саме знання, і водієві воно потрібне разом, а не
 * двома різними екранами.
 */

type Comment = {
  id: string;
  text: string;
  photoUrl: string | null;
  /** Де стояв телефон у мить зйомки — не координати клієнта. */
  lat: number | null;
  lng: number | null;
  createdAt: string;
  author: { id: string; name: string };
  canEdit: boolean;
};

/** Довша сторона знімка після стиснення, px. */
const MAX_SIDE = 1600;

/**
 * Стискаємо знімок у браузері перед відправкою.
 *
 * Телефон віддає 3-5 МБ на кадр, а по дорозі в село це хвилина очікування
 * і обірваний запит. 1600 px по довшій стороні вистачає, щоб роздивитися
 * ворота й вивіску, і дає файл на кілька сотень кілобайт.
 *
 * Якщо щось пішло не так (браузер не дав canvas, екзотичний формат) —
 * повертаємо оригінал: краще повільно, ніж ніяк.
 */
async function compress(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.8)
    );
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], "location.jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

const dt = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function ClientCommentsModal({
  client,
  onClose,
  onSaved,
}: {
  client: { id: string; name: string };
  onClose: () => void;
  /** Щоб карта могла одразу показати щойно додане фото на точці. */
  onSaved?: () => void;
}) {
  const { data: session } = useSession();
  const { data, loading, error, reload } = useApi<{ comments: Comment[] }>(
    `/api/admin/client-comments/${client.id}`
  );

  const [text, setText] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /** Стиснений знімок, який піде разом із текстом. */
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  /** Вибір готового файлу — галерея. */
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * Запасний шлях до камери — системний вибір із наміром «зняти».
   *
   * Окремим input-ом, а не атрибутом на першому: `capture` не можна
   * приставити на мить кліку, а два приховані поля нічого не коштують.
   */
  const captureRef = useRef<HTMLInputElement>(null);

  /**
   * Камера прямо в сторінці.
   *
   * `<input capture="environment">` — лише прохання, і контейнер має право
   * його не почути: у WebView вибір файлу цілком віддано нативному коду, і
   * той відкриває документи, а не камеру. Саме тому «зняти фото» на планшеті
   * перетворювалось на «вибрати з галереї».
   *
   * getUserMedia від контейнера не залежить: кадр беремо самі з потоку. Якщо
   * дозволу немає або камери немає взагалі — тихо відкочуємось на системний
   * вибір, бо краще галерея, ніж кнопка, яка не робить нічого.
   */
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  /** Чому камера не відкрилась — показуємо замість мовчазного відкату. */
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
    setCameraReady(false);
  };

  /**
   * Чому не «тихо відкотитись на вибір файлу».
   *
   * Спершу так і було: не вийшло увімкнути камеру — відкриваємо системний
   * вибір. Виглядало це для людини рівно як «тисну "зняти фото", а воно
   * показує галерею», і причина лишалась невидимою. Мовчазний відкат
   * ховає саме те, що треба полагодити: дозвіл, зайняту камеру або
   * контейнер, який камеру сторінці взагалі не дає.
   *
   * Тому тепер кажемо, що сталося, і лишаємо обидва шляхи кнопками — щоб
   * людина могла і зняти зараз, і зрозуміти, що ввімкнути потім.
   */
  const openCamera = async () => {
    setActionError(null);
    setCameraError(null);

    if (!window.isSecureContext) {
      setCameraError("Камера доступна лише через захищене з'єднання (https).");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Цей застосунок не дає сторінці доступ до камери.");
      return;
    }

    try {
      streamRef.current = await navigator.mediaDevices.getUserMedia({
        // Тилова камера: знімають ворота, а не себе. `ideal`, а не `exact` —
        // на планшеті без тилової камери exact просто впав би.
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      setCameraOn(true);
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      setCameraError(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Доступ до камери заборонено. Дозвольте камеру для застосунку в налаштуваннях телефона."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Камери не знайдено."
            : name === "NotReadableError"
              ? "Камеру зайняв інший застосунок. Закрийте його й спробуйте ще раз."
              : `Не вдалося увімкнути камеру${name ? ` (${name})` : ""}.`
      );
    }
  };

  /** Потік чіпляємо після того, як <video> опинився в дереві. */
  useEffect(() => {
    if (!cameraOn) return;
    const v = videoRef.current;
    if (!v || !streamRef.current) return;
    v.srcObject = streamRef.current;
    v.play().catch(() => {});
  }, [cameraOn]);

  /**
   * Камеру гасимо й на розмонтуванні. Без цього вона лишається зайнятою
   * після закриття модалки — на планшеті це видно по індикатору, і людина
   * справедливо вирішує, що застосунок за нею підглядає.
   */
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    []
  );

  const pickPhoto = async (file: File | null) => {
    if (!file) return;
    setActionError(null);
    setPreparing(true);
    try {
      const small = await compress(file);
      setPhoto(small);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(small);
      });
    } finally {
      setPreparing(false);
    }
  };

  const dropPhoto = () => {
    setPhoto(null);
    setPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    // Обидва поля: інакше повторний вибір ТОГО САМОГО файлу не дасть
    // події change, і кнопка виглядатиме зламаною.
    if (fileRef.current) fileRef.current.value = "";
    if (captureRef.current) captureRef.current.value = "";
  };

  /** Знімок із живого потоку — кадр як він є на екрані. */
  const shoot = async () => {
    const v = videoRef.current;
    if (!v?.videoWidth) return;
    setPreparing(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) return;
      // Гасимо камеру одразу після кадру: далі вона не потрібна, а тримати
      // її ввімкненою поки людина пише коментар — це і батарея, і індикатор.
      stopCamera();
      // Той самий шлях стиснення, що й для файлу з галереї: 1600 px по
      // довшій стороні, інакше кадр планшета їде в село кілька хвилин.
      const small = await compress(new File([blob], "location.jpg", { type: "image/jpeg" }));
      setPhoto(small);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(small);
      });
    } finally {
      setPreparing(false);
    }
  };

  /**
   * Де стоїть телефон. Чекаємо не довше 8 секунд і не блокуємо відправку:
   * фото воріт без координат корисніше, ніж помилка «немає геолокації».
   */
  const whereAmI = (): Promise<{ lat: number; lng: number } | null> =>
    new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
      );
    });

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Esc закриває: модалка перекриває карту, і тягтися до хрестика незручно.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async () => {
    const value = (editing ? editing.text : text).trim();
    // Порожній текст дозволено, якщо є фото: знімок воріт сам собою вже
    // відповідь на питання «куди під'їжджати».
    if (!value && !(photo && !editing)) return;

    setBusy(true);
    setActionError(null);
    try {
      let res: Response;
      if (photo && !editing) {
        const form = new FormData();
        form.set("text", value);
        form.set("photo", photo);
        const at = await whereAmI();
        if (at) {
          form.set("lat", String(at.lat));
          form.set("lng", String(at.lng));
        }
        // Content-Type не ставимо руками: браузер сам додасть boundary.
        res = await fetch(`/api/admin/client-comments/${client.id}`, {
          method: "POST",
          body: form,
        });
      } else {
        res = await fetch(
          editing
            ? `/api/admin/client-comments/comment/${editing.id}`
            : `/api/admin/client-comments/${client.id}`,
          {
            method: editing ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: value }),
          }
        );
      }
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      setText("");
      setEditing(null);
      dropPhoto();
      reload();
      onSaved?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося зберегти коментар");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/client-comments/comment/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok) throw new Error(json?.error ?? `Помилка ${res.status}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Не вдалося видалити коментар");
    } finally {
      setBusy(false);
    }
  };

  const comments = data?.comments ?? [];

  return (
    <>
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-[var(--radius-card)] bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-bk">{client.name}</h3>
            <p className="text-xs text-gr">
              Домовленості, особливості, фото локації: як заїхати й де розвантажувати
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрити"
            className="ml-auto shrink-0 rounded-[var(--radius-btn)] border border-line px-2 py-0.5 text-sm text-bk"
          >
            ✕
          </button>
        </div>

        {/* Форма: зверху, бо найчастіше сюди заходять саме дописати */}
        <div className="mb-3">
          <textarea
            ref={inputRef}
            value={editing ? editing.text : text}
            onChange={(e) =>
              editing ? setEditing({ ...editing, text: e.target.value }) : setText(e.target.value)
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            rows={3}
            maxLength={2000}
            placeholder="Наприклад: заїзд з двору, ворота зелені; бере лише по понеділках; після 15:00 зачинено"
            className="w-full rounded-[var(--radius-btn)] border border-line px-2.5 py-1.5 text-sm text-bk"
          />
          {/* Фото локації. Кнопка одразу під полем: у полі спершу знімають,
              а вже потім думають, що дописати. */}
          {!editing && (
            <div className="mt-2 flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                className="hidden"
                aria-label="Фото з галереї"
              />
              {/* Запасний шлях: системний вибір із наміром «зняти». Сюди
                  потрапляємо, лише коли getUserMedia недоступний. */}
              <input
                ref={captureRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)}
                className="hidden"
                aria-label="Зняти фото"
              />
              {/* Зйомка — головна дія: торговий стоїть біля цих самих воріт.
                  Галерея поруч і дрібніша: нею користуються, коли зняли
                  раніше або телефон не дав камеру. */}
              <button
                type="button"
                onClick={openCamera}
                disabled={busy || preparing}
                className="rounded-[var(--radius-btn)] bg-bk px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                {preparing ? "Готую знімок…" : photo ? "📷 Перезняти" : "📷 Зняти фото"}
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy || preparing}
                className="rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-sm text-bk disabled:opacity-50"
              >
                Галерея
              </button>

              {preview && (
                <span className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt="Прев'ю фото локації"
                    className="h-11 w-11 rounded-[var(--radius-btn)] object-cover"
                  />
                  <button
                    type="button"
                    onClick={dropPhoto}
                    disabled={busy}
                    className="text-xs text-gr underline disabled:opacity-50"
                  >
                    Прибрати
                  </button>
                </span>
              )}
            </div>
          )}

          {/*
            Камера не відкрилась — кажемо чому і лишаємо обидва шляхи.
            «Системна камера» — той самий input із capture: у частині
            контейнерів він камеру таки відкриває, хоч і не в усіх, тож
            це справжня друга спроба, а не втішна кнопка.
          */}
          {!editing && cameraError && (
            <div
              className="mt-2 rounded-[var(--radius-btn)] p-2.5"
              style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}
            >
              <p style={{ fontSize: "12px", color: "#92400E", margin: 0, lineHeight: 1.4 }}>
                {cameraError}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => captureRef.current?.click()}
                  className="rounded-[var(--radius-btn)] border border-line bg-white px-3 py-1.5 text-sm text-bk"
                >
                  Системна камера
                </button>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="rounded-[var(--radius-btn)] border border-line bg-white px-3 py-1.5 text-sm text-bk"
                >
                  Вибрати з галереї
                </button>
                <button
                  type="button"
                  onClick={openCamera}
                  className="rounded-[var(--radius-btn)] px-3 py-1.5 text-sm text-gr underline"
                  style={{ background: "none", border: "none" }}
                >
                  Спробувати ще раз
                </button>
              </div>
            </div>
          )}

          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={
                busy || preparing || (!(editing ? editing.text : text).trim() && !(photo && !editing))
              }
              className="rounded-[var(--radius-btn)] bg-bk px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {busy ? "Зберігаю…" : editing ? "Зберегти" : photo ? "Додати з фото" : "Додати"}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-[var(--radius-btn)] border border-line px-3 py-1.5 text-sm text-bk"
              >
                Скасувати
              </button>
            )}
            <span className="ml-auto text-xs text-gr">Ctrl+Enter — зберегти</span>
          </div>
        </div>

        {actionError && <div className="mb-3"><ErrorBox message={actionError} /></div>}
        {error && <div className="mb-3"><ErrorBox message={error} onRetry={reload} /></div>}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading && !data && <p className="text-sm text-gr">Завантаження…</p>}
          {!loading && comments.length === 0 && (
            <p className="text-sm text-gr">
              Записів ще немає. Коментар і фото звідси побачить кожен, хто відкриє цього
              клієнта, — зокрема водій перед розвантаженням.
            </p>
          )}
          <ul className="space-y-2.5">
            {comments.map((c) => (
              <li key={c.id} className="rounded-[var(--radius-card)] border border-line px-3 py-2">
                <div className="flex items-center gap-2 text-xs text-gr">
                  <span className="font-medium text-bk">{c.author.name}</span>
                  <span>{dt.format(new Date(c.createdAt))}</span>
                  {c.author.id === session?.user?.id && <span>· ваш</span>}
                  {c.canEdit && (
                    <span className="ml-auto flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditing({ id: c.id, text: c.text })}
                        className="underline"
                      >
                        Змінити
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        disabled={busy}
                        className="text-rd underline disabled:opacity-50"
                      >
                        Видалити
                      </button>
                    </span>
                  )}
                </div>
                {c.text && <p className="mt-1 whitespace-pre-wrap text-sm text-bk">{c.text}</p>}

                {c.photoUrl && (
                  <div className="mt-1.5">
                    {/* Посилання, а не лайтбокс: на телефоні системний
                        переглядач дає зум пальцями й «зберегти», а свій
                        довелося б писати заради того самого. */}
                    <a href={c.photoUrl} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={c.photoUrl}
                        alt="Фото локації клієнта"
                        loading="lazy"
                        className="max-h-56 w-full rounded-[var(--radius-btn)] object-cover"
                      />
                    </a>
                    {c.lat != null && c.lng != null && (
                      <a
                        href={`https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-xs text-gr underline"
                      >
                        Знято тут ({c.lat.toFixed(5)}, {c.lng.toFixed(5)})
                      </a>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>

    {/*
      Видошукач на весь екран, поверх модалки.
      Сусідом до неї, а не всередині: та закривається по кліку в підкладку,
      і тап по кадру гасив би всю форму разом із набраним текстом.
    */}
    {cameraOn && (
      <div className="fixed inset-0 z-[2100] flex flex-col bg-black">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          onLoadedMetadata={() => setCameraReady(true)}
          className="min-h-0 flex-1 object-contain"
        />
        <div
          className="flex items-center justify-between gap-4 px-6 py-5"
          style={{ paddingBottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <button
            type="button"
            onClick={stopCamera}
            className="text-sm text-white/70"
            style={{ background: "none", border: "none" }}
          >
            Скасувати
          </button>
          {/* Кругла кнопка спуску: у неї цілять пальцем у робочій рукавиці,
              тож 72 px, а не звичайні 44. */}
          <button
            type="button"
            onClick={shoot}
            disabled={!cameraReady || preparing}
            aria-label="Зняти"
            className="rounded-full disabled:opacity-40"
            style={{
              width: "72px",
              height: "72px",
              background: "#fff",
              border: "4px solid rgba(255,255,255,0.35)",
              backgroundClip: "padding-box",
            }}
          />
          {/* Порожній блок тієї ж ширини, що «Скасувати»: без нього спуск
              з'їжджає з центру екрана. */}
          <span aria-hidden className="text-sm text-transparent">
            Скасувати
          </span>
        </div>
      </div>
    )}
    </>
  );
}
