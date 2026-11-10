import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isPaidPlan, PLANS, type PaidPlanId, type PlanId } from "@/lib/billing/plans";
import type { User } from "./auth";
import { config, HttpError } from "./config";
import { db } from "./db";
import { currentMonth } from "./time";

/**
 * Plans and payments. Stripe holds the subscription; an account keeps a copy
 * of its state (plan, status, renewal) so that nothing on the hot path calls
 * Stripe. The copy is refreshed when checkout returns and by webhooks.
 *
 * Billing is on only when STRIPE_SECRET_KEY is set. Off, nothing is
 * paywalled.
 */

export const billingEnabled = () => !!config.stripe.secretKey;

export type Subscription = {
  id: string;
  status: string;
  plan: PaidPlanId;
  /** When the current period ends (ms). */
  renewsAt?: number;
  cancelAtPeriodEnd?: boolean;
};

/** Billing state kept with the account. */
export type AccountData = {
  stripeCustomerId?: string;
  subscription?: Subscription;
  /** 3D builds started this calendar month. */
  builds?: { month: string; count: number };
  /** A plan given by hand, without a subscription. */
  comp?: PaidPlanId;
};

export function accountOf(userId: string): AccountData {
  const row = db().prepare("SELECT data FROM users WHERE id = ?").get(userId) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as AccountData) : {};
}

function updateAccount(userId: string, change: (a: AccountData) => void): AccountData {
  const account = accountOf(userId);
  change(account);
  db().prepare("UPDATE users SET data = ? WHERE id = ?").run(JSON.stringify(account), userId);
  return account;
}

/** Statuses in which a subscription still gives access. Stripe retries failed payments while past_due. */
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export const hasActiveSubscription = (a: AccountData) => !!a.subscription && ACTIVE.has(a.subscription.status);

export function planOf(user: User | null): PlanId {
  if (!user) return "free";
  if (config.stripe.compEmails.includes(user.email)) return "pro";
  const account = accountOf(user.id);
  if (account.comp) return account.comp;
  return hasActiveSubscription(account) ? account.subscription!.plan : "free";
}

export function buildsUsed(userId: string, now = new Date()): number {
  const b = accountOf(userId).builds;
  return b?.month === currentMonth(now) ? b.count : 0;
}

export function countBuild(userId: string, now = new Date()) {
  const used = buildsUsed(userId, now);
  updateAccount(userId, (a) => {
    a.builds = { month: currentMonth(now), count: used + 1 };
  });
}

/** What the account pages show. */
export function billingView(user: User) {
  const account = accountOf(user.id);
  const plan = planOf(user);
  const sub = hasActiveSubscription(account) ? account.subscription! : null;
  return {
    plan,
    builds: { used: buildsUsed(user.id), limit: PLANS[plan].builds },
    /** Whether there is a Stripe customer whose billing can be managed. */
    manageable: !!account.stripeCustomerId && !!sub,
    status: sub?.status ?? null,
    renewsAt: sub?.renewsAt ?? null,
    cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
  };
}

// --- Stripe ---------------------------------------------------------------

type StripeSubscription = {
  id: string;
  status: string;
  customer: string | { id: string };
  cancel_at_period_end?: boolean;
  /** Top-level in older API versions, per item in newer ones. */
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: { data?: { current_period_end?: number; price?: { id?: string } }[] };
};

type StripeCheckoutSession = {
  id: string;
  url?: string;
  status?: string;
  client_reference_id?: string | null;
  customer?: string | { id: string } | null;
  subscription?: string | StripeSubscription | null;
};

async function stripe<T>(method: "GET" | "POST", path: string, params: Record<string, string> = {}): Promise<T> {
  if (!config.stripe.secretKey) throw new HttpError(503, "Payments aren't set up.");
  const query = new URLSearchParams(params);
  const url = `${config.stripe.apiBase}/v1/${path}`;
  const res = await fetch(method === "GET" && query.size ? `${url}?${query}` : url, {
    method,
    headers: {
      authorization: `Bearer ${config.stripe.secretKey}`,
      ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: method === "POST" ? query : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    console.error(`[stripe] ${method} ${path} failed (${res.status}): ${data.error?.message ?? ""}`);
    throw new HttpError(502, "The payment service didn't respond as expected. Try again in a moment.");
  }
  return data;
}

const idOf = (x: string | { id: string } | null | undefined) => (typeof x === "string" ? x : (x?.id ?? null));

function planForPrice(priceId: string | undefined): PaidPlanId | null {
  if (!priceId) return null;
  if (priceId === config.stripe.prices.creator) return "creator";
  if (priceId === config.stripe.prices.pro) return "pro";
  return null;
}

/** Sends the person to Stripe Checkout for a plan. Returns the URL to open. */
export async function createCheckout(user: User, plan: PaidPlanId): Promise<string> {
  const account = accountOf(user.id);
  if (hasActiveSubscription(account)) throw new HttpError(409, "You already have a plan. Use Manage billing to change it.");
  const priceId = config.stripe.prices[plan];
  const session = await stripe<StripeCheckoutSession>("POST", "checkout/sessions", {
    mode: "subscription",
    client_reference_id: user.id,
    success_url: `${config.appUrl}/billing/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appUrl}/pricing`,
    allow_promotion_codes: "true",
    "line_items[0][quantity]": "1",
    ...(priceId
      ? { "line_items[0][price]": priceId }
      : {
          "line_items[0][price_data][currency]": "usd",
          "line_items[0][price_data][unit_amount]": String(PLANS[plan].price * 100),
          "line_items[0][price_data][recurring][interval]": "month",
          "line_items[0][price_data][product_data][name]": `iident ${PLANS[plan].name}`,
        }),
    "subscription_data[metadata][plan]": plan,
    "subscription_data[metadata][user_id]": user.id,
    ...(account.stripeCustomerId ? { customer: account.stripeCustomerId } : { customer_email: user.email }),
  });
  if (!session.url) throw new HttpError(502, "Checkout could not be started.");
  return session.url;
}

/** Copies a Stripe subscription's state onto the account. */
function saveSubscription(userId: string, sub: StripeSubscription) {
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  updateAccount(userId, (a) => {
    // The price decides the plan when prices are configured (it changes on an upgrade); otherwise the plan chosen at checkout.
    const plan = planForPrice(item?.price?.id) ?? (isPaidPlan(sub.metadata?.plan) ? sub.metadata.plan : (a.subscription?.plan ?? "creator"));
    a.stripeCustomerId = idOf(sub.customer) ?? a.stripeCustomerId;
    a.subscription = {
      id: sub.id,
      status: sub.status,
      plan,
      renewsAt: periodEnd ? periodEnd * 1000 : undefined,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    };
  });
}

/**
 * Called when the person returns from checkout: reads the session from
 * Stripe and, if it is theirs and paid, records the plan. This makes the
 * plan active at once, without waiting for (or depending on) a webhook.
 */
export async function confirmCheckout(user: User, sessionId: string): Promise<PlanId> {
  if (!/^cs_[A-Za-z0-9_]{8,200}$/.test(sessionId)) throw new HttpError(400, "That checkout link isn't valid.");
  const session = await stripe<StripeCheckoutSession>("GET", `checkout/sessions/${sessionId}`, { "expand[]": "subscription" });
  if (session.client_reference_id !== user.id) throw new HttpError(403, "That checkout belongs to another account.");
  const sub = session.subscription;
  if (session.status !== "complete" || !sub || typeof sub === "string") throw new HttpError(402, "That checkout wasn't completed.");
  saveSubscription(user.id, sub);
  return planOf(user);
}

/** A link to Stripe's billing portal (change plan, card, cancel). */
export async function createPortal(user: User): Promise<string> {
  const { stripeCustomerId } = accountOf(user.id);
  if (!stripeCustomerId) throw new HttpError(400, "There is no billing to manage yet.");
  const session = await stripe<{ url: string }>("POST", "billing_portal/sessions", {
    customer: stripeCustomerId,
    return_url: `${config.appUrl}/me`,
  });
  return session.url;
}

/** Checks a webhook's `Stripe-Signature` header against the raw body. */
export function verifyWebhook(rawBody: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!timestamp || !signatures.length) return false;
  // Old events replayed later are refused.
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  return signatures.some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

function userIdForCustomer(customerId: string | null): string | null {
  if (!customerId) return null;
  const row = db().prepare("SELECT id FROM users WHERE json_extract(data, '$.stripeCustomerId') = ?").get(customerId) as { id: string } | undefined;
  return row?.id ?? null;
}

type StripeEvent = { type: string; data: { object: Record<string, unknown> } };

/**
 * Applies a verified webhook event. Events can arrive late or out of order,
 * so the event only says which subscription changed; its current state is
 * read from Stripe.
 */
export async function handleWebhookEvent(event: StripeEvent) {
  let subscriptionId: string | null = null;
  let userId: string | null = null;
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as StripeCheckoutSession;
    subscriptionId = idOf(session.subscription as string | { id: string } | null);
    userId = session.client_reference_id ?? null;
  } else if (/^customer\.subscription\.(created|updated|deleted)$/.test(event.type)) {
    subscriptionId = (event.data.object as StripeSubscription).id;
  }
  if (!subscriptionId) return;
  const sub = await stripe<StripeSubscription>("GET", `subscriptions/${subscriptionId}`);
  userId = userId ?? sub.metadata?.user_id ?? userIdForCustomer(idOf(sub.customer));
  if (!userId || !db().prepare("SELECT 1 FROM users WHERE id = ?").get(userId)) return;
  // An older subscription ending must not overwrite a newer one.
  const current = accountOf(userId).subscription;
  if (current && current.id !== sub.id && ACTIVE.has(current.status) && !ACTIVE.has(sub.status)) return;
  saveSubscription(userId, sub);
}
