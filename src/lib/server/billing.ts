import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isPaidPlan, PLANS, type PaidPlanId, type PlanId } from "@/lib/billing/plans";
import type { User } from "./auth";
import { config, HttpError } from "./config";
import { one, transaction } from "./pg";
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

export async function accountOf(userId: string): Promise<AccountData> {
  return (await one<{ data: AccountData }>("SELECT data FROM users WHERE id = $1", [userId]))?.data ?? {};
}

/** Changes an account's billing state. The row is locked meanwhile, so concurrent changes don't overwrite each other. */
function updateAccount(userId: string, change: (a: AccountData) => void): Promise<AccountData> {
  return transaction(async (tx) => {
    const [row] = await tx.query<{ data: AccountData }>("SELECT data FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const account = row?.data ?? {};
    if (!row) return account;
    change(account);
    await tx.query("UPDATE users SET data = $2::jsonb WHERE id = $1", [userId, JSON.stringify(account)]);
    return account;
  });
}

/** Statuses in which a subscription still gives access. Stripe retries failed payments while past_due. */
const ACTIVE = new Set(["active", "trialing", "past_due"]);

export const hasActiveSubscription = (a: AccountData) => !!a.subscription && ACTIVE.has(a.subscription.status);

/** The plan an account's state gives the person. */
function planFrom(user: User, account: AccountData): PlanId {
  if (config.stripe.compEmails.includes(user.email)) return "pro";
  if (account.comp) return account.comp;
  return hasActiveSubscription(account) ? account.subscription!.plan : "free";
}

export async function planOf(user: User | null): Promise<PlanId> {
  return user ? planFrom(user, await accountOf(user.id)) : "free";
}

const buildsIn = (account: AccountData, now: Date) => (account.builds?.month === currentMonth(now) ? account.builds.count : 0);

export async function buildsUsed(userId: string, now = new Date()): Promise<number> {
  return buildsIn(await accountOf(userId), now);
}

export async function countBuild(userId: string, now = new Date()) {
  await updateAccount(userId, (a) => {
    a.builds = { month: currentMonth(now), count: buildsIn(a, now) + 1 };
  });
}

/**
 * Whether a 3D build has to be paid for. Always, on a live site: a build
 * costs a couple of dollars, so it never starts before payment. Only a
 * development server with payments switched off builds for free.
 */
export const buildNeedsPayment = () => billingEnabled() || process.env.NODE_ENV === "production";

/**
 * Checks that an account's plan lets it start a 3D build now. Returns the
 * account to count the build against, or null when this build isn't
 * counted: a retry after a failed build isn't charged twice.
 */
export async function requireBuildAllowance(user: User, retry: boolean, now = new Date()): Promise<string | null> {
  const account = await accountOf(user.id);
  const plan = PLANS[planFrom(user, account)];
  // A live site with no payment service can't take the payment a build needs. Accounts in COMP_EMAILS still have a plan.
  if (!plan.builds && !billingEnabled()) throw new HttpError(503, "3D builds open as soon as payments are set up on this site.");
  if (!plan.builds) throw new HttpError(402, "Bringing your character to life in 3D is part of the Creator plan.");
  if (retry) return null;
  if (buildsIn(account, now) >= plan.builds) {
    throw new HttpError(402, `You've used all ${plan.builds} of this month's 3D builds on the ${plan.name} plan. They reset next month.`);
  }
  return user.id;
}

/** What the account pages show. */
export async function billingView(user: User) {
  const account = await accountOf(user.id);
  const plan = planFrom(user, account);
  const sub = hasActiveSubscription(account) ? account.subscription! : null;
  return {
    plan,
    builds: { used: buildsIn(account, new Date()), limit: PLANS[plan].builds },
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

async function stripe<T>(method: "GET" | "POST" | "DELETE", path: string, params: Record<string, string> = {}): Promise<T> {
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
  const account = await accountOf(user.id);
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
          "line_items[0][price_data][product_data][name]": `Twiins ${PLANS[plan].name}`,
          "line_items[0][price_data][product_data][tax_code]": config.stripe.taxCode,
        }),
    "subscription_data[metadata][plan]": plan,
    "subscription_data[metadata][user_id]": user.id,
    ...(account.stripeCustomerId ? { customer: account.stripeCustomerId } : { customer_email: user.email }),
  });
  if (!session.url) throw new HttpError(502, "Checkout could not be started.");
  return session.url;
}

/** Copies a Stripe subscription's state onto the account. */
async function saveSubscription(userId: string, sub: StripeSubscription) {
  const item = sub.items?.data?.[0];
  const periodEnd = item?.current_period_end ?? sub.current_period_end;
  await updateAccount(userId, (a) => {
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
  await saveSubscription(user.id, sub);
  return planOf(user);
}

/**
 * Ends an account's subscription now, so that deleting an account never
 * leaves someone paying for it. Throws if Stripe can't be reached: the
 * account must then not be deleted either.
 */
export async function cancelSubscription(userId: string): Promise<boolean> {
  const account = await accountOf(userId);
  if (!hasActiveSubscription(account)) return false;
  await stripe("DELETE", `subscriptions/${account.subscription!.id}`);
  await updateAccount(userId, (a) => {
    if (a.subscription) a.subscription = { ...a.subscription, status: "canceled" };
  });
  return true;
}

/** A link to Stripe's billing portal (change plan, card, cancel). */
export async function createPortal(user: User): Promise<string> {
  const { stripeCustomerId } = await accountOf(user.id);
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

async function userIdForCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  return (await one<{ id: string }>("SELECT id FROM users WHERE data->>'stripeCustomerId' = $1", [customerId]))?.id ?? null;
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
  userId = userId ?? sub.metadata?.user_id ?? (await userIdForCustomer(idOf(sub.customer)));
  if (!userId || !(await one("SELECT 1 FROM users WHERE id = $1", [userId]))) return;
  // An older subscription ending must not overwrite a newer one.
  const current = (await accountOf(userId)).subscription;
  if (current && current.id !== sub.id && ACTIVE.has(current.status) && !ACTIVE.has(sub.status)) return;
  await saveSubscription(userId, sub);
}
