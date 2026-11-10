"use client";

import { useCallback, useEffect, useState } from "react";
import { api, type Account } from "./api";

const NEXT_KEY = "iident:after-sign-in";

/** Only paths inside the app: never follow a link to another site after signing in. */
export const safeNext = (path: string | null | undefined) => (path && /^\/(?![/\\])/.test(path) ? path : null);

/**
 * Remembers where to go after signing in. Kept in the browser because the
 * sign-in link opens in a new tab.
 */
export function rememberNext(path: string | null) {
  try {
    if (path) localStorage.setItem(NEXT_KEY, path);
    else localStorage.removeItem(NEXT_KEY);
  } catch {}
}

export function takeNext(): string | null {
  try {
    const path = safeNext(localStorage.getItem(NEXT_KEY));
    localStorage.removeItem(NEXT_KEY);
    return path;
  } catch {
    return null;
  }
}

/** The signed-in account: undefined while loading, `user: null` for a visitor. */
export function useAccount() {
  const [account, setAccount] = useState<Account | undefined>(undefined);
  const refresh = useCallback(() => {
    api
      .me()
      .then(setAccount)
      .catch(() => setAccount({ user: null, avatars: [] }));
  }, []);
  useEffect(refresh, [refresh]);
  return { account, refresh };
}
