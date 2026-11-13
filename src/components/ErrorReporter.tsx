"use client";

import { useEffect } from "react";

/**
 * Sends errors that happen in someone's browser to the site's own log, so
 * that a page breaking on a phone nobody tested is noticed. Only the message,
 * the stack and the page path are sent, at most a few per visit.
 */
export function ErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const report = (message: string, detail?: string) => {
      if (!message || sent >= 5) return;
      sent++;
      const body = JSON.stringify({ message: message.slice(0, 500), detail: detail?.slice(0, 4000), page: location.pathname.slice(0, 200) });
      void fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    };
    const onError = (e: ErrorEvent) => report(e.message, e.error instanceof Error ? e.error.stack : `${e.filename}:${e.lineno}`);
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason: unknown = e.reason;
      // A request the page cancelled itself is not an error.
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      report(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
