"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PlanSummary } from "@/components/billing/PlanSummary";
import { Button, Card, Logo, Notice, Spinner } from "@/components/ui";
import { useAccount } from "@/lib/client/account";
import { api, forgetDraft, type AvatarSummary } from "@/lib/client/api";
import { SiteFooter } from "@/components/SiteFooter";

function statusOf(a: AvatarSummary): { label: string; className: string } {
  if (a.suspended) return { label: "Taken down", className: "bg-red-50 text-red-700" };
  if (a.published && a.ready && a.usage.paused) return { label: "Paused", className: "bg-amber-50 text-amber-800" };
  if (a.published && a.ready) return { label: "Live", className: "bg-emerald-50 text-emerald-700" };
  if (a.building) return { label: "Building in 3D", className: "bg-accent-50 text-accent-700" };
  if (a.ready) return { label: "Not published", className: "bg-peach-100 text-ink-700" };
  return { label: "Draft", className: "bg-ink-100 text-ink-600" };
}

/** The account page: every avatar the signed-in person owns, on any device. */
export function YourAvatars() {
  const router = useRouter();
  const { account, refresh } = useAccount();
  const [leaving, setLeaving] = useState(false);
  // Deleting takes a second click: the id of the avatar (or "account") waiting for it.
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAvatar(id);
      forgetDraft(id);
      setConfirming(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  async function removeAccount() {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteAccount();
      router.replace("/");
    } catch (e) {
      setError((e as Error).message);
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (account && !account.user) router.replace("/login?next=/me");
  }, [account, router]);

  if (!account?.user) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner className="size-8 text-accent-500" />
      </div>
    );
  }

  async function signOut() {
    setLeaving(true);
    await api.signOut().catch(() => {});
    router.replace("/");
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Twiins home">
          <Logo />
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden truncate text-sm text-ink-500 sm:block">{account.user.email}</span>
          {account.user.admin && (
            <Link href="/admin" className="rounded-full px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100">
              Admin
            </Link>
          )}
          <Button variant="ghost" size="sm" loading={leaving} onClick={signOut}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-16 pt-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">Your avatars</h1>
            <p className="mt-1 text-sm text-ink-600 sm:hidden">{account.user.email}</p>
          </div>
          <Link
            href="/create"
            className="inline-flex h-10 items-center rounded-full bg-accent-500 px-5 text-sm font-medium text-white shadow-soft transition hover:bg-accent-600"
          >
            New avatar
          </Link>
        </div>

        <PlanSummary billing={account.billing} />
        {error && (
          <div className="mt-4">
            <Notice tone="error">{error}</Notice>
          </div>
        )}

        {account.avatars.length === 0 ? (
          <Card className="mt-8 p-8 text-center">
            <h2 className="text-lg font-semibold text-ink-900">Nothing here yet</h2>
            <p className="mx-auto mt-1 max-w-sm text-sm text-ink-600">
              Start with a selfie. Your avatar is saved to this account as you go, so you can pick it up on any device.
            </p>
            <Link
              href="/create"
              className="mt-5 inline-flex h-11 items-center rounded-full bg-accent-500 px-6 text-sm font-medium text-white shadow-soft transition hover:bg-accent-600"
            >
              Create your avatar
            </Link>
          </Card>
        ) : (
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {account.avatars.map((a) => {
              const status = statusOf(a);
              return (
                <li key={a.id}>
                  <Card className="flex h-full flex-col overflow-hidden">
                    <Link href={`/create?id=${a.id}`} className="block bg-gradient-to-b from-accent-50 to-peach-100">
                      {a.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={a.imageUrl} alt="" className="mx-auto h-56 w-full object-contain" />
                      ) : (
                        <div className="grid h-56 place-items-center text-sm text-ink-500">No character yet</div>
                      )}
                    </Link>
                    <div className="flex flex-1 flex-col p-4">
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="truncate font-semibold text-ink-900">{a.name || "Untitled avatar"}</h2>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
                      </div>
                      {a.published && a.slug ? (
                        <p className="mt-1 truncate text-xs text-ink-500">
                          <span>/a/{a.slug}</span>
                          <span> · </span>
                          <span>
                            {a.usage.replies}
                            {a.usage.paused
                              ? " replies this month · paused, no plan"
                              : // With plans the allowance is the account's, shown above the list.
                                `${!account.billing.enabled && a.usage.limit ? ` of ${a.usage.limit}` : ""} replies this month`}
                          </span>
                        </p>
                      ) : a.suspended ? (
                        <p className="mt-1 text-xs text-ink-500">We took this avatar down after a report. Contact us if you think that&apos;s a mistake.</p>
                      ) : (
                        <p className="mt-1 text-xs text-ink-500">Only you can see it.</p>
                      )}
                      <div className="mt-auto flex gap-2 pt-4">
                        <Link
                          href={`/create?id=${a.id}`}
                          className="inline-flex h-9 items-center rounded-full border border-ink-200 bg-card px-4 text-sm font-medium text-ink-800 transition hover:border-ink-300 hover:bg-ink-50"
                        >
                          Edit
                        </Link>
                        {a.published && a.slug && a.ready && !a.suspended && (
                          <Link
                            href={`/a/${a.slug}`}
                            className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-ink-700 transition hover:bg-ink-100"
                          >
                            Open page
                          </Link>
                        )}
                        {confirming !== a.id && (
                          <button
                            type="button"
                            onClick={() => setConfirming(a.id)}
                            className="ml-auto inline-flex h-9 items-center rounded-full px-3 text-sm text-ink-500 transition hover:bg-red-50 hover:text-red-700"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                      {confirming === a.id && (
                        <div className="mt-3 rounded-2xl bg-red-50 p-3 text-sm text-red-900">
                          <p>Delete this avatar with its photo, voice recording and 3D model? This can&apos;t be undone.</p>
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" variant="dark" loading={deleting} onClick={() => remove(a.id)}>
                              Delete for good
                            </Button>
                            <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirming(null)}>
                              Keep it
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}

        <section className="mt-12 border-t border-ink-100 pt-6">
          <h2 className="text-sm font-semibold text-ink-900">Delete your account</h2>
          <p className="mt-1 max-w-xl text-sm text-ink-600">
            Removes your account and every avatar in it, with their photos, voice recordings and 3D models, and ends your plan now. This can&apos;t be undone.
          </p>
          {confirming === "account" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="dark" loading={deleting} onClick={removeAccount}>
                Yes, delete everything
              </Button>
              <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirming(null)}>
                Keep my account
              </Button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming("account")} className="mt-3 text-sm font-medium text-red-700 hover:underline">
              Delete my account
            </button>
          )}
        </section>
      </main>
      <SiteFooter className="max-w-5xl" />
    </div>
  );
}
