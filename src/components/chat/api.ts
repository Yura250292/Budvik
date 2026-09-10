"use client";

/** Типи й запити чату — спільні для екрана, шапки й шторки пересилання. */

import type { GroupRole } from "@/lib/chat/audience";

export type Person = { id: string; name: string; role: string; avatarUrl: string | null; color: string | null };

export type ChatPhoto = { id: string; url: string; width: number; height: number };

export type ChatMessage = {
  id: string;
  kind: "TEXT" | "ASSISTANT";
  text: string;
  quote: string | null;
  toAll: boolean;
  toRoles: string[];
  toUserId: string | null;
  sourceSection: string | null;
  createdAt: string;
  author: Person;
  photos: ChatPhoto[];
  keys: string[];
  /** Локальні стани оптимістичного повідомлення. */
  pending?: boolean;
  failed?: boolean;
};

export type ConversationSummary = {
  key: string;
  type: "all" | "role" | "dm" | "journal";
  label: string;
  userId?: string;
  unread: number;
  last: { id: string; text: string; authorName: string; kind: "TEXT" | "ASSISTANT"; hasPhotos: boolean; createdAt: string } | null;
};

export type ConversationsResponse = {
  me: { id: string; role: string };
  conversations: ConversationSummary[];
  totalUnread: number;
  people: Person[];
  canPickGroups: boolean;
  /** Чи є зареєстрований пристрій — від цього залежить, чи прийде сповіщення. */
  pushReady: boolean;
};

export type ReadMark = { userId: string; readAt: string };

export type ThreadResponse = {
  conversation: { key: string; type: ConversationSummary["type"]; label: string; canWrite: boolean; userId?: string };
  messages: ChatMessage[];
  hasMore: boolean;
  reads: ReadMark[];
};

/** Хто вже переглянув повідомлення, а хто ще ні. */
export type ReadStatus = {
  seenBy: Person[];
  pending: Person[];
  /** Особиста розмова: галочка означає «прочитав співрозмовник». */
  isDm: boolean;
};

export type Audience = { toAll: boolean; toRoles: GroupRole[]; toUserId: string | null };

export type UploadedPhoto = { key: string; url: string; width: number; height: number; bytes: number };

export type SendInput = Audience & {
  text?: string;
  photos?: UploadedPhoto[];
  sourceAssistantMessageId?: string;
  sourceSection?: string;
};

export const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Помилка ${res.status}`);
  return body;
};

export async function sendMessage(input: SendInput): Promise<{ message: ChatMessage; conversation: string }> {
  const res = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Помилка ${res.status}`);
  return body;
}

export async function uploadPhoto(file: File, width: number, height: number): Promise<UploadedPhoto> {
  /**
   * Файл іде СИРИМ тілом, без конверта multipart.
   *
   * Той конверт складає браузер, але в застосунку він приїздив на сервер без
   * boundary — і запит падав ще до нашого коду (та сама вада зламала фото
   * профілю 10.09). Одне поле з одним файлом не варте конверта, який може
   * розклеїтись; розміри, відомі після стиснення, їдуть у запиті.
   */
  const res = await fetch(`/api/chat/upload?w=${width}&h=${height}`, {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `Помилка ${res.status}`);
  return body;
}

export async function markConversationRead(conversation: string, upTo: string): Promise<void> {
  await fetch("/api/chat/read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation, upTo }),
  }).catch(() => {});
}
