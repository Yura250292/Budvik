"use client";

/**
 * Нове повідомлення: спершу кому, потім що.
 *
 * Окремий екран, а не вибір усередині розмови: адреса вирішує, у якій
 * стрічці повідомлення опиниться, і міняти її посеред набраного тексту —
 * найкоротший шлях надіслати не тим.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { Callout } from "@/components/cabinet/ui";
import { AudiencePicker, EMPTY_AUDIENCE, audienceChosen } from "./AudiencePicker";
import { ChatComposer } from "./ChatComposer";
import { CONVERSATIONS_URL } from "./ConversationList";
import { COPY } from "./copy";
import { fetcher, sendMessage, type Audience, type ConversationsResponse, type UploadedPhoto } from "./api";

export function NewMessageScreen({ base, embedded }: { base: string; embedded: boolean }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data } = useSWR<ConversationsResponse>(CONVERSATIONS_URL, fetcher, { revalidateOnFocus: false });
  const [audience, setAudience] = useState<Audience>(EMPTY_AUDIENCE);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (photos: UploadedPhoto[], typed: string) => {
    if (!audienceChosen(audience)) {
      setError(COPY.pickAudience);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await sendMessage({ ...audience, text: typed.trim(), photos });
      void mutate(CONVERSATIONS_URL);
      router.replace(`${base}/${res.conversation}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не вдалося надіслати");
      setBusy(false);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={`mx-auto flex w-full ${embedded ? "max-w-3xl" : "max-w-lg"} flex-col gap-3 px-4 py-4`}>
          {!!error && <Callout title="Не вийшло" tone="bad">{error}</Callout>}
          {data ? (
            <AudiencePicker
              value={audience}
              onChange={setAudience}
              people={data.people}
              me={data.me}
              canPickGroups={data.canPickGroups}
            />
          ) : (
            <p className="py-6 text-center text-sm text-cab-t3">{COPY.loading}</p>
          )}
        </div>
      </div>
      <div className={`mx-auto w-full ${embedded ? "max-w-3xl" : "max-w-lg"}`}>
        <ChatComposer
          value={draft}
          onChange={setDraft}
          onSend={(photos, text) => void submit(photos, text)}
          busy={busy}
          disabled={!data}
        />
      </div>
    </>
  );
}
