"use client";

/**
 * Поле вводу чату: текст, голос і фото.
 *
 * Голос той самий, що в помічника (useVoiceInput): продиктоване лягає В
 * ПОЛЕ, а не летить одразу — у машині швидше виправити слово, ніж слати
 * друге повідомлення слідом.
 *
 * Фото вантажаться ОДРАЗУ при виборі, а не разом із текстом: поки людина
 * дописує, файл уже їде. Кнопка «Надіслати» чекає лише на те, що ще летить.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, Mic, SendHorizontal, X } from "lucide-react";
import { useVoiceInput } from "@/components/sales/assistant/useVoiceInput";
import { compress } from "@/components/cabinet/photo/compress";
import { useInPageCamera } from "@/components/cabinet/photo/useInPageCamera";
import { CameraView } from "@/components/cabinet/photo/CameraView";
import { uploadPhoto, type UploadedPhoto } from "./api";
import { COPY } from "./copy";

const MAX_PHOTOS = 4;

type Pending = { id: string; preview: string; uploaded: UploadedPhoto | null; failed?: boolean };

export function ChatComposer({
  value,
  onChange,
  onSend,
  busy,
  disabled = false,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  /** Фото віддаємо вже завантаженими — роут повідомлень приймає лише ключі. */
  onSend: (photos: UploadedPhoto[]) => void;
  busy: boolean;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const camera = useInPageCamera();
  const voice = useVoiceInput((text) => onChange(text));

  // Поле росте до чотирьох рядків і далі прокручується.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  // Прев'ю живуть на blob-адресах — звільняємо, коли екран зникає.
  useEffect(
    () => () => {
      setPhotos((prev) => {
        prev.forEach((p) => URL.revokeObjectURL(p.preview));
        return [];
      });
    },
    []
  );

  const accept = async (files: File[]) => {
    setError(null);
    const room = MAX_PHOTOS - photos.length;
    if (room <= 0) {
      setError(COPY.maxPhotos);
      return;
    }
    for (const file of files.slice(0, room)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const shot = await compress(file);
      const preview = URL.createObjectURL(shot.file);
      setPhotos((prev) => [...prev, { id, preview, uploaded: null }]);
      try {
        const uploaded = await uploadPhoto(shot.file, shot.width, shot.height);
        setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, uploaded } : p)));
      } catch (e) {
        setPhotos((prev) => prev.map((p) => (p.id === id ? { ...p, failed: true } : p)));
        setError(e instanceof Error ? e.message : "Не вдалося завантажити фото");
      }
    }
  };

  const drop = (id: string) => {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((p) => p.id !== id);
    });
    // Обидва поля: інакше повторний вибір ТОГО САМОГО файлу не дасть події change.
    if (galleryRef.current) galleryRef.current.value = "";
    if (captureRef.current) captureRef.current.value = "";
  };

  const uploading = photos.some((p) => !p.uploaded && !p.failed);
  const ready = photos.filter((p) => p.uploaded).map((p) => p.uploaded!) as UploadedPhoto[];
  const canSend = !busy && !uploading && !disabled && (value.trim().length > 0 || ready.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(ready);
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setPhotos([]);
    setError(null);
  };

  const shoot = async () => {
    const shot = await camera.shoot();
    if (!shot) return;
    await accept([shot.file]);
  };

  return (
    <>
      <div className="border-t border-cab-line bg-white px-4 py-2.5">
        {!!error && <p className="mb-1.5 text-[11px] text-bad-fg">{error}</p>}
        {!!camera.error && (
          <div className="mb-2 rounded-xl border border-warn-line bg-warn-bg p-2.5">
            <p className="text-[12px] leading-snug text-warn-fg">{camera.error}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => captureRef.current?.click()} className="rounded-xl border border-cab-line bg-white px-3 py-1.5 text-sm text-bk">
                {COPY.systemCamera}
              </button>
              <button type="button" onClick={() => galleryRef.current?.click()} className="rounded-xl border border-cab-line bg-white px-3 py-1.5 text-sm text-bk">
                {COPY.gallery}
              </button>
              <button type="button" onClick={() => void camera.open()} className="px-2 py-1.5 text-sm text-cab-t3 underline">
                {COPY.retryCamera}
              </button>
            </div>
          </div>
        )}
        {voice.error && <p className="mb-1.5 text-[11px] text-bad-fg">{voice.error}</p>}
        {voice.state === "listening" && <p className="mb-1.5 text-[11px] font-semibold text-info-fg">🎤 Слухаю — натисніть ще раз, коли скажете</p>}
        {voice.state === "sending" && <p className="mb-1.5 text-[11px] font-semibold text-cab-t2">⏳ Розпізнаю…</p>}

        {photos.length > 0 && (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {photos.map((p) => (
              <span key={p.id} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.preview}
                  alt="Фото до надсилання"
                  className={`h-16 w-16 rounded-xl object-cover ${p.uploaded ? "" : "opacity-60"}`}
                />
                {p.failed && <span className="absolute inset-x-0 bottom-0 rounded-b-xl bg-bad-fg px-1 text-center text-[9px] font-bold text-white">Збій</span>}
                <button
                  type="button"
                  onClick={() => drop(p.id)}
                  aria-label="Прибрати фото"
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-bk text-white"
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        )}

        <input
          ref={galleryRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => void accept([...(e.target.files ?? [])])}
          className="hidden"
          aria-label={COPY.gallery}
        />
        {/* Запасний шлях: системний вибір із наміром «зняти». У WebView він
            відкриває документи, тому головна кнопка — камера в сторінці. */}
        <input
          ref={captureRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => void accept([...(e.target.files ?? [])])}
          className="hidden"
          aria-label={COPY.camera}
        />

        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label={COPY.camera}
            onClick={() => void camera.open()}
            disabled={disabled || photos.length >= MAX_PHOTOS}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cab-line text-cab-t2 disabled:opacity-40"
          >
            <Camera size={18} />
          </button>
          <button
            type="button"
            aria-label={COPY.gallery}
            onClick={() => galleryRef.current?.click()}
            disabled={disabled || photos.length >= MAX_PHOTOS}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cab-line text-cab-t2 disabled:opacity-40"
          >
            <ImageIcon size={18} />
          </button>

          <textarea
            ref={ref}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            enterKeyHint="send"
            maxLength={4000}
            disabled={disabled}
            placeholder={placeholder ?? COPY.placeholder}
            // 16px обов'язково: менший шрифт змушує мобільний браузер
            // масштабувати сторінку при фокусі.
            className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-xl border border-cab-line bg-white px-3 py-2.5 text-base text-bk outline-none placeholder:text-cab-t3 focus:border-bk disabled:bg-cab-bg"
          />

          {voice.supported && (
            <button
              type="button"
              aria-label={voice.state === "listening" ? "Зупинити диктування" : "Сказати повідомлення"}
              onClick={voice.toggle}
              disabled={disabled || voice.state === "sending"}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-50 ${
                voice.state === "listening" ? "bg-bad-fg text-white" : "border border-cab-line text-cab-t2"
              }`}
            >
              <Mic size={18} />
            </button>
          )}
          <button
            type="button"
            aria-label={COPY.send}
            onClick={submit}
            disabled={!canSend}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-bk disabled:opacity-40"
          >
            <SendHorizontal size={18} />
          </button>
        </div>
        {uploading && <p className="mt-1 text-[11px] text-cab-t3">{COPY.uploading}</p>}
      </div>

      <CameraView
        on={camera.on}
        ready={camera.ready}
        videoRef={camera.videoRef}
        onLoaded={camera.onLoaded}
        onClose={camera.close}
        onShoot={() => void shoot()}
        busy={uploading}
      />
    </>
  );
}
