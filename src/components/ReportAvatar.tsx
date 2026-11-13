"use client";

import { useState, type FormEvent } from "react";
import { api } from "@/lib/client/api";
import { cx } from "@/components/ui";

const REASONS = [
  { id: "impersonation", label: "It's me or someone I know, made without permission" },
  { id: "inappropriate", label: "It says or shows something harmful or inappropriate" },
  { id: "other", label: "Something else" },
];

/** "Report" on an avatar's page: a short form that reaches the people who run the site. */
export function ReportAvatar({ slug, dark }: { slug: string; dark: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0].id);
  const [details, setDetails] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.report({ slug, reason, details, email });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cx("underline", dark ? "hover:text-white/70" : "hover:text-ink-800")}>
        Report
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Report this avatar" className="fixed inset-0 z-50 grid place-items-end bg-ink-900/50 p-3 text-left sm:place-items-center">
          <div className="w-full max-w-md rounded-3xl bg-card p-5 text-ink-900 shadow-lift">
            {sent ? (
              <>
                <h2 className="text-lg font-semibold">Thank you</h2>
                <p className="mt-1 text-sm text-ink-600">We&apos;ve got your report and will look at it.</p>
                <button type="button" onClick={() => setOpen(false)} className="mt-4 h-10 w-full rounded-full bg-ink-900 text-sm font-medium text-white">
                  Close
                </button>
              </>
            ) : (
              <form onSubmit={submit}>
                <h2 className="text-lg font-semibold">Report this avatar</h2>
                <fieldset className="mt-3 space-y-2">
                  <legend className="sr-only">What&apos;s wrong?</legend>
                  {REASONS.map((r) => (
                    <label key={r.id} className="flex items-start gap-2 text-sm text-ink-800">
                      <input type="radio" name="reason" className="mt-1" checked={reason === r.id} onChange={() => setReason(r.id)} />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </fieldset>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  placeholder="Anything that helps us understand (optional)"
                  className="mt-3 w-full rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm outline-none focus:border-accent-400"
                />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={254}
                  placeholder="Your email, if you'd like a reply (optional)"
                  className="mt-2 h-10 w-full rounded-xl border border-ink-200 bg-white px-3 text-sm outline-none focus:border-accent-400"
                />
                {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
                <div className="mt-4 flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="h-10 flex-1 rounded-full border border-ink-200 text-sm font-medium text-ink-800">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy} className="h-10 flex-1 rounded-full bg-ink-900 text-sm font-medium text-white disabled:opacity-50">
                    {busy ? "Sending…" : "Send report"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
