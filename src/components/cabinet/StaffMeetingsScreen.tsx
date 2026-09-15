"use client";

import type { ReactNode } from "react";
import useSWR from "swr";
import { Body, Card, Note, Page, Pill } from "@/components/cabinet/ui";
import { EmptyState } from "@/components/ui/Card";
import { ErrorBox } from "@/components/ui/ErrorBox";
import type { SharedMeetingRow } from "@/lib/meetings/types";
import { fetchJson, meetingWhen } from "./meeting-text";

/**
 * Підсумки нарад, які керівник надіслав людині, — спільний екран торгового,
 * водія й складу. Відкрита нарада — StaffMeetingScreen.
 */
export default function StaffMeetingsScreen({ header, base }: { header: ReactNode; base: string }) {
  const { data, error, mutate } = useSWR("/api/meetings", (u: string) => fetchJson<{ items: SharedMeetingRow[] }>(u));
  const items = data?.items ?? [];

  return (
    <>
      {header}
      <Page>
        {error && <ErrorBox message={error.message} onRetry={() => void mutate()} />}

        {data && items.length === 0 && (
          <Card>
            <EmptyState
              title="Підсумків нарад ще немає"
              hint="Коли керівник надішле підсумок наради, він з'явиться тут і прийде сповіщенням."
            />
          </Card>
        )}

        {items.map((m) => (
          <Card key={m.id} href={`${base}/meetings/${m.id}`} tone={m.myOpenTasks > 0 ? "warn" : "plain"}>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[15px] font-bold leading-snug text-bk">{m.title}</p>
                {m.isNew && <Pill tone="info">Нова</Pill>}
              </div>
              <Note>
                {meetingWhen(m.recordedAt, m.audioDurationMs)} · {m.createdByName}
              </Note>
              {m.teaser && <Body>{m.teaser}</Body>}
              {(m.myOpenTasks > 0 || m.decisions > 0) && (
                <div className="flex flex-wrap gap-1.5">
                  {m.myOpenTasks > 0 && <Pill tone="warn">Ваших задач: {m.myOpenTasks}</Pill>}
                  {m.decisions > 0 && <Pill tone="neutral">Рішень: {m.decisions}</Pill>}
                </div>
              )}
            </div>
          </Card>
        ))}
      </Page>
    </>
  );
}
