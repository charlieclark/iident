"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Card } from "@/components/ui";
import { PLANS } from "@/lib/billing/plans";
import { api, type Billing } from "@/lib/client/api";

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });

/** The account's plan, what is left of it this month, and the way to change it. */
export function PlanSummary({ billing }: { billing: Billing }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!billing.enabled || !billing.plan) return null;
  const plan = PLANS[billing.plan];
  const paid = billing.plan !== "free";

  async function manage() {
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.billingPortal();
      window.location.assign(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 p-4 sm:px-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-900">
          <span>{plan.name} plan</span>
          {billing.status === "past_due" && <span className="font-medium text-amber-700"> · payment failed, update your card</span>}
        </p>
        <p className="mt-0.5 text-xs text-ink-600">
          {paid ? (
            <>
              <span>
                {billing.live?.used ?? 0} of {plan.avatars} live · {billing.replies?.used ?? 0} of {plan.replies.toLocaleString("en-US")} replies and{" "}
                {billing.builds?.used ?? 0} of {plan.builds} builds in 3D this month
              </span>
              {billing.renewsAt && <span>{` · ${billing.cancelAtPeriodEnd ? "ends" : "renews"} ${day(billing.renewsAt)}`}</span>}
            </>
          ) : (
            <span>Design as many characters as you like. A plan brings one to life in 3D and puts it on a link.</span>
          )}
        </p>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
      {billing.manageable ? (
        <Button variant="secondary" size="sm" loading={busy} onClick={manage}>
          Manage billing
        </Button>
      ) : (
        !paid && (
          <Link href="/pricing?next=/me" className="inline-flex h-8 items-center rounded-full bg-accent-500 px-3.5 text-sm font-medium text-white transition hover:bg-accent-600">
            See plans
          </Link>
        )
      )}
    </Card>
  );
}
