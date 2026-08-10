"use client";

import { useEffect, useState } from "react";

/**
 * Власний профіль для шапок кабінетів.
 *
 * Чому не сесія: у JWT лежить зліпок на момент входу, і після заміни
 * аватарки чи телефона він не оновлюється — у шапці висіло б старе фото
 * до наступного логіну. /api/account/profile завжди віддає актуальне.
 *
 * Відповідь кешуємо в модулі: шапка адмінки і шапка торгового живуть у
 * різних деревах, а на кожній навігації монтуються заново — без кешу це
 * був би зайвий запит на кожен перехід.
 */

export type Profile = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  avatarUrl: string | null;
  color: string | null;
};

let cache: Profile | null = null;
let inflight: Promise<Profile | null> | null = null;

function load(): Promise<Profile | null> {
  if (cache) return Promise.resolve(cache);
  inflight ??= fetch("/api/account/profile")
    .then((r) => (r.ok ? r.json() : null))
    .then((d: Profile | null) => {
      if (d) cache = d;
      return d;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Скинути кеш після зміни профілю — інакше шапка покаже старе фото. */
export function invalidateProfile() {
  cache = null;
  window.dispatchEvent(new Event("profile-updated"));
}

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(cache);

  useEffect(() => {
    let alive = true;
    load().then((d) => alive && setProfile(d));

    const onUpdate = () => {
      load().then((d) => alive && setProfile(d));
    };
    window.addEventListener("profile-updated", onUpdate);
    return () => {
      alive = false;
      window.removeEventListener("profile-updated", onUpdate);
    };
  }, []);

  return profile;
}
