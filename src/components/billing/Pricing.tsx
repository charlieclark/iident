"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AccountLink } from "@/components/account/AccountLink";
import { SiteFooter } from "@/components/SiteFooter";
import { Button, cx, Logo, Notice } from "@/components/ui";
import { isPaidPlan, PLAN_ORDER, PLANS, type PaidPlanId, type Plan } from "@/lib/billing/plans";
import { rememberNext, safeNext, useAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";

function Check() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="mt-0.5 size-4 shrink-0 text-accent-500">
      <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The plans, with buttons that lead through sign-in and checkout and back to where the person was. */
export function Pricing() {
  const params = useSearchParams();
  const router = useRouter();
  const { account } = useAccount();
  const next = safeNext(params.get("next"));
  const chosen = params.get("plan");
  const [busy, setBusy] = useState<PaidPlanId | "manage" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoStarted = useRef(false);

  const billing = account?.billing;
  const current = billing?.enabled && account?.user ? (billing.plan ?? "free") : null;

  async function choose(plan: PaidPlanId) {
    setError(null);
    if (!account?.user) {
      // Come back here after signing in and carry on to checkout.
      const back = `/pricing?plan=${plan}${next ? `&next=${encodeURIComponent(next)}` : ""}`;
      router.push(`/login?next=${encodeURIComponent(back)}`);
      return;
    }
    setBusy(plan);
    try {
      rememberNext(next);
      const { url } = await api.checkout(plan);
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function manage() {
    setBusy("manage");
    setError(null);
    try {
      const { url } = await api.billingPortal();
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  // Back from signing in with a plan already picked: go straight on to checkout.
  useEffect(() => {
    if (autoStarted.current || !account?.user || !billing?.enabled || current !== "free" || !isPaidPlan(chosen)) return;
    autoStarted.current = true;
    void choose(chosen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, chosen]);

  function action(plan: Plan) {
    if (!account) return <Button size="lg" className="w-full" variant="secondary" disabled loading />;
    const linkClass = "inline-flex h-12 w-full items-center justify-center rounded-full border border-ink-200 bg-card text-base font-medium text-ink-800 transition hover:border-ink-300 hover:bg-ink-50";
    if (!billing?.enabled || !isPaidPlan(plan.id)) {
      if (current && current !== "free" && plan.id === "free") return <p className="grid h-12 place-items-center text-sm text-ink-500">Included in your plan</p>;
      return (
        <Link href={next ?? "/create"} className={linkClass}>
          {plan.id === "free" ? "Start designing" : "Create your avatar"}
        </Link>
      );
    }
    if (current === plan.id) return <p className="grid h-12 place-items-center text-sm font-medium text-accent-700">Your plan</p>;
    if (current && current !== "free") {
      return (
        <Button size="lg" className="w-full" variant="secondary" loading={busy === "manage"} onClick={manage}>
          Switch to {plan.name}
        </Button>
      );
    }
    const id = plan.id;
    return (
      <Button size="lg" className="w-full" variant={id === "creator" ? "primary" : "dark"} loading={busy === id} disabled={!!busy} onClick={() => choose(id)}>
        Choose {plan.name}
      </Button>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Twiins home">
          <Logo />
        </Link>
        <AccountLink next={next ?? "/pricing"} />
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-6 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-ink-900 sm:text-5xl">Design it free. Pay when it comes to life.</h1>
          <p className="mt-4 text-lg text-ink-600">
            Turning a selfie into your character costs nothing. A plan builds it in 3D, gives it your voice and puts it on a link anyone can talk to.
          </p>
        </div>

        {error && (
          <div className="mx-auto mt-6 max-w-xl">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
        {account && !billing?.enabled && (
          <div className="mx-auto mt-6 max-w-xl">
            <Notice tone="warn">Payments aren&apos;t switched on here, so everything is open.</Notice>
          </div>
        )}

        <ul className="mt-10 grid gap-5 lg:grid-cols-3">
          {PLAN_ORDER.map((id) => {
            const plan = PLANS[id];
            const featured = id === "creator";
            return (
              <li
                key={id}
                className={cx(
                  "flex flex-col rounded-3xl border bg-card p-6 shadow-soft sm:p-7",
                  featured ? "border-accent-300 ring-2 ring-accent-100" : "border-ink-100",
                )}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-ink-900">{plan.name}</h2>
                  {featured && <span className="rounded-full bg-accent-50 px-2.5 py-0.5 text-xs font-medium text-accent-700">Most people start here</span>}
                </div>
                <p className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-semibold tracking-tight text-ink-900">${plan.price}</span>
                  <span className="text-sm text-ink-500">{plan.price ? "a month" : "forever"}</span>
                </p>
                <p className="mt-2 text-sm text-ink-600">{plan.tagline}</p>
                <ul className="mt-5 flex-1 space-y-2.5 text-sm text-ink-800">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <Check />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6">{action(plan)}</div>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-center text-sm text-ink-500">
          Plans are billed monthly and you can cancel any time. If a plan ends, your avatars are kept and stop answering until you&apos;re back.
        </p>
      </main>
      <SiteFooter />
    </div>
  );
}
