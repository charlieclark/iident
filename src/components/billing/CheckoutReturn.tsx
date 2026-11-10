"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Card, Logo, Notice, Spinner } from "@/components/ui";
import { PLANS } from "@/lib/billing/plans";
import { takeNext } from "@/lib/client/account";
import { api } from "@/lib/client/api";

/** Where Stripe Checkout sends people back: records the plan, then returns them to what they were doing. */
export function CheckoutReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const sessionId = params.get("session_id");
  const [error, setError] = useState<string | null>(sessionId ? null : "This page needs a checkout to confirm.");
  const [planName, setPlanName] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!sessionId || started.current) return;
    started.current = true;
    api
      .confirmCheckout(sessionId)
      .then(({ plan }) => {
        setPlanName(PLANS[plan].name);
        const next = takeNext() ?? "/me";
        setTimeout(() => router.replace(next), 1400);
      })
      .catch((e: Error) => setError(e.message));
  }, [sessionId, router]);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" aria-label="iident home" className="mb-8 self-center">
        <Logo />
      </Link>
      <Card className="p-6 text-center sm:p-8">
        {error ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">We couldn&apos;t confirm your plan</h1>
            <div className="mt-4 text-left">
              <Notice tone="error">{error}</Notice>
            </div>
            <p className="mt-4 text-sm text-ink-600">If you were charged, your plan will show up on your account shortly.</p>
            <Link href="/me" className="mt-4 inline-block text-sm font-medium text-accent-700 hover:underline">
              Go to your avatars
            </Link>
          </>
        ) : planName ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">You&apos;re on {planName}</h1>
            <p className="mt-2 text-sm text-ink-600">Taking you back to your avatar.</p>
          </>
        ) : (
          <>
            <Spinner className="size-7 text-accent-500" />
            <p className="mt-3 text-sm text-ink-600">Setting up your plan</p>
          </>
        )}
      </Card>
    </div>
  );
}
