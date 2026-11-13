"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Logo, Notice, Spinner } from "@/components/ui";
import { api, ApiError, type AdminAction, type AdminOverview as Overview } from "@/lib/client/api";

const STEP_LABELS: Record<string, string> = {
  signed_up: "Signed up",
  selfie_uploaded: "Uploaded a photo",
  previewed: "Previewed a look",
  character_created: "Created a character",
  checkout_started: "Opened checkout",
  plan_started: "Started a plan",
  build_started: "Started a 3D build",
  build_ready: "3D build finished",
  published: "Published",
};

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * For the people who run the site (ADMIN_EMAILS): how far people get, how
 * builds are going, what broke, and reports to act on.
 */
export function AdminOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .adminOverview()
      .then(setData)
      .catch((e) => (e instanceof ApiError && (e.status === 404 || e.status === 401) ? setDenied(true) : setError((e as Error).message)));
  }, []);
  useEffect(load, [load]);

  async function act(key: string, action: AdminAction) {
    setBusy(key);
    setError(null);
    try {
      await api.adminAction(action);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (denied) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-ink-600">
        <p>This page doesn&apos;t exist.</p>
        <Link href="/" className="mt-3 inline-block font-medium text-accent-700 hover:underline">
          Go home
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="grid min-h-dvh place-items-center">{error ? <Notice tone="error">{error}</Notice> : <Spinner className="size-8 text-accent-500" />}</div>
    );
  }

  const first = data.steps[0]?.month ?? 0;
  return (
    <div className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">
      <header className="flex items-center justify-between py-5">
        <Link href="/" aria-label="Twiins home">
          <Logo />
        </Link>
        <Link href="/me" className="rounded-full px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100">
          Your avatars
        </Link>
      </header>
      <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Admin</h1>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink-900">Reports to look at</h2>
        {data.reports.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">None open.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.reports.map((r) => (
              <li key={r.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink-900">
                        {r.slug ? (
                          <a href={`/a/${r.slug}`} target="_blank" rel="noreferrer" className="underline">
                            /a/{r.slug}
                          </a>
                        ) : (
                          r.avatarId
                        )}
                        <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{r.reason}</span>
                      </p>
                      {r.details && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-700">{r.details}</p>}
                      <p className="mt-1 text-xs text-ink-500">
                        {when(r.createdAt)}
                        {r.reporterEmail ? ` · reply to ${r.reporterEmail}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="dark" loading={busy === `down:${r.id}`} onClick={() => act(`down:${r.id}`, { action: "take-down", avatarId: r.avatarId, reason: r.reason })}>
                        Take down
                      </Button>
                      <Button size="sm" variant="secondary" loading={busy === `dismiss:${r.id}`} onClick={() => act(`dismiss:${r.id}`, { action: "dismiss", reportId: r.id })}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.takenDown.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink-900">Taken down</h2>
          <ul className="mt-3 space-y-2">
            {data.takenDown.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink-100 bg-card px-4 py-3 text-sm">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-ink-900">{a.name || "Untitled"}</span>
                  <span className="text-ink-500">
                    {a.slug ? ` · /a/${a.slug}` : ""} · {a.reason} · {when(a.at)}
                  </span>
                </span>
                <Button size="sm" variant="secondary" loading={busy === `restore:${a.id}`} onClick={() => act(`restore:${a.id}`, { action: "restore", avatarId: a.id })}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">How far people get</h2>
        <p className="mt-1 text-sm text-ink-500">People who reached each step. The last column is the share of people who signed up in the same 30 days.</p>
        <Card className="mt-3 overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                <th className="px-4 py-2 font-medium">Step</th>
                <th className="px-4 py-2 text-right font-medium">24 hours</th>
                <th className="px-4 py-2 text-right font-medium">7 days</th>
                <th className="px-4 py-2 text-right font-medium">30 days</th>
                <th className="px-4 py-2 text-right font-medium">Of sign-ups</th>
              </tr>
            </thead>
            <tbody>
              {data.steps.map((s) => (
                <tr key={s.step} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-2 text-ink-900">{STEP_LABELS[s.step] ?? s.step}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.day}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.week}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{s.month}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-ink-500">{first ? `${Math.round((s.month / first) * 100)}%` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <p className="mt-3 text-sm text-ink-600">
          3D builds in the last 30 days: {data.builds.started} started, {data.builds.ready} finished, {data.builds.failed} failed.
        </p>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink-900">Recent errors</h2>
        {data.errors.length === 0 ? (
          <p className="mt-2 text-sm text-ink-500">Nothing has gone wrong lately.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {data.errors.map((e) => (
              <li key={e.id} className="rounded-2xl border border-ink-100 bg-card px-4 py-3 text-sm">
                <details>
                  <summary className="cursor-pointer">
                    <span className="mr-2 rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700">{e.source}</span>
                    <span className="text-ink-900">{e.message}</span>
                    <span className="ml-2 text-xs text-ink-500">
                      {e.route ? `${e.route} · ` : ""}
                      {when(e.at)}
                    </span>
                  </summary>
                  {e.detail && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-ink-600">{e.detail}</pre>}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
