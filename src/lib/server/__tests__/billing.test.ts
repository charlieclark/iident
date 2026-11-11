import { createHmac } from "node:crypto";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { freshDatabase } from "../../../../test/database";

describe("billing", () => {
  let auth: typeof import("../auth");
  let billing: typeof import("../billing");
  let db: typeof import("../db");
  let usage: typeof import("../usage");
  let config: typeof import("../config").config;

  beforeAll(async () => {
    await freshDatabase("billing");
    process.env.STRIPE_SECRET_KEY = "sk_test_placeholder";
    process.env.COMP_EMAILS = "friend@example.com";
    db = await import("../db");
    auth = await import("../auth");
    billing = await import("../billing");
    usage = await import("../usage");
    ({ config } = await import("../config"));
  });
  afterEach(() => vi.unstubAllGlobals());

  let n = 0;
  const newUser = async (email = `user${++n}@example.com`) => (await auth.consumeLoginToken((await auth.createLoginToken(email))!))!;

  /** Stripe as seen by fetch: answers by path, records what was sent. */
  function fakeStripe(routes: Record<string, unknown>) {
    const calls: { method: string; path: string; params: URLSearchParams }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const u = new URL(url);
      const path = u.pathname.replace("/v1/", "");
      calls.push({ method: init.method!, path, params: init.method === "POST" ? new URLSearchParams(String(init.body)) : u.searchParams });
      const body = routes[path];
      return new Response(JSON.stringify(body ?? { error: { message: "no such thing" } }), { status: body ? 200 : 404 });
    });
    return calls;
  }

  const subscription = (userId: string, over: Record<string, unknown> = {}) => ({
    id: "sub_1",
    status: "active",
    customer: `cus_${userId}`,
    cancel_at_period_end: false,
    metadata: { plan: "creator", user_id: userId },
    items: { data: [{ current_period_end: 1800000000, price: { id: "price_x" } }] },
    ...over,
  });
  const paidSession = (userId: string, sub: unknown) => ({ id: "cs_test_12345678", status: "complete", client_reference_id: userId, customer: `cus_${userId}`, subscription: sub });

  it("starts checkout for the plan's price and ties it to the account", async () => {
    const user = await newUser();
    const calls = fakeStripe({ "checkout/sessions": { id: "cs_test_1", url: "https://checkout.stripe.test/pay" } });
    expect(await billing.createCheckout(user, "creator")).toBe("https://checkout.stripe.test/pay");
    const sent = Object.fromEntries(calls[0].params);
    expect(sent).toMatchObject({
      mode: "subscription",
      client_reference_id: user.id,
      customer_email: user.email,
      "line_items[0][price_data][unit_amount]": "1000",
      "line_items[0][price_data][recurring][interval]": "month",
      "subscription_data[metadata][plan]": "creator",
    });
    expect(sent.success_url).toContain("/billing/return?session_id={CHECKOUT_SESSION_ID}");
    // Configured price ids are used instead of an inline price.
    config.stripe.prices.pro = "price_pro";
    await billing.createCheckout(user, "pro");
    expect(calls[1].params.get("line_items[0][price]")).toBe("price_pro");
    expect(calls[1].params.has("line_items[0][price_data][unit_amount]")).toBe(false);
    config.stripe.prices.pro = undefined;
  });

  it("gives the plan once checkout is confirmed, and only to the account that paid", async () => {
    const user = await newUser();
    const other = await newUser();
    expect(await billing.planOf(user)).toBe("free");
    fakeStripe({ "checkout/sessions/cs_test_12345678": paidSession(user.id, subscription(user.id)) });
    await expect(billing.confirmCheckout(other, "cs_test_12345678")).rejects.toMatchObject({ status: 403 });
    await expect(billing.confirmCheckout(user, "../customers")).rejects.toMatchObject({ status: 400 });
    expect(await billing.confirmCheckout(user, "cs_test_12345678")).toBe("creator");
    expect(await billing.planOf(other)).toBe("free");
    expect(await billing.billingView(user)).toMatchObject({ plan: "creator", manageable: true, renewsAt: 1800000000000, builds: { used: 0, limit: 2 } });
    // A second checkout isn't started while a plan is active.
    await expect(billing.createCheckout(user, "pro")).rejects.toMatchObject({ status: 409 });
  });

  it("does not give a plan for an unfinished checkout", async () => {
    const user = await newUser();
    fakeStripe({ "checkout/sessions/cs_test_12345678": { ...paidSession(user.id, null), status: "open" } });
    await expect(billing.confirmCheckout(user, "cs_test_12345678")).rejects.toMatchObject({ status: 402 });
    expect(await billing.planOf(user)).toBe("free");
  });

  it("follows webhooks: upgrade by price, cancellation, and an old subscription ending", async () => {
    const user = await newUser();
    config.stripe.prices.pro = "price_pro";
    fakeStripe({ "subscriptions/sub_1": subscription(user.id) });
    await billing.handleWebhookEvent({ type: "checkout.session.completed", data: { object: { client_reference_id: user.id, subscription: "sub_1" } } });
    expect(await billing.planOf(user)).toBe("creator");

    // Switched to Pro in the billing portal: the price changes, the checkout metadata doesn't.
    fakeStripe({ "subscriptions/sub_1": subscription(user.id, { items: { data: [{ price: { id: "price_pro" } }] } }) });
    await billing.handleWebhookEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect(await billing.planOf(user)).toBe("pro");

    // An earlier subscription ending doesn't take the current plan away.
    fakeStripe({ "subscriptions/sub_0": subscription(user.id, { id: "sub_0", status: "canceled" }) });
    await billing.handleWebhookEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_0" } } });
    expect(await billing.planOf(user)).toBe("pro");

    // Found by customer when the subscription carries no user id.
    fakeStripe({ "subscriptions/sub_1": subscription(user.id, { status: "canceled", metadata: {} }) });
    await billing.handleWebhookEvent({ type: "customer.subscription.deleted", data: { object: { id: "sub_1" } } });
    expect(await billing.planOf(user)).toBe("free");
    config.stripe.prices.pro = undefined;
  });

  it("keeps access while a payment is being retried", async () => {
    const user = await newUser();
    fakeStripe({ "subscriptions/sub_1": subscription(user.id, { status: "past_due" }) });
    await billing.handleWebhookEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect(await billing.planOf(user)).toBe("creator");
    fakeStripe({ "subscriptions/sub_1": subscription(user.id, { status: "unpaid" }) });
    await billing.handleWebhookEvent({ type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
    expect(await billing.planOf(user)).toBe("free");
  });

  it("checks webhook signatures", async () => {
    const secret = "whsec_test";
    const body = '{"type":"customer.subscription.updated"}';
    const t = Math.floor(Date.now() / 1000);
    const sign = (ts: number, payload: string, key = secret) => `t=${ts},v1=${createHmac("sha256", key).update(`${ts}.${payload}`).digest("hex")}`;
    expect(billing.verifyWebhook(body, sign(t, body), secret)).toBe(true);
    expect(billing.verifyWebhook(body + " ", sign(t, body), secret)).toBe(false);
    expect(billing.verifyWebhook(body, sign(t, body, "whsec_other"), secret)).toBe(false);
    expect(billing.verifyWebhook(body, sign(t - 3600, body), secret)).toBe(false);
    expect(billing.verifyWebhook(body, null, secret)).toBe(false);
    expect(billing.verifyWebhook(body, "t=,v1=", secret)).toBe(false);
  });

  it("counts 3D builds per calendar month", async () => {
    const user = await newUser();
    const nov = new Date("2026-11-20T00:00:00Z");
    await billing.countBuild(user.id, nov);
    await billing.countBuild(user.id, nov);
    expect(await billing.buildsUsed(user.id, nov)).toBe(2);
    expect(await billing.buildsUsed(user.id, new Date("2026-12-01T00:00:00Z"))).toBe(0);
  });

  it("gives comp accounts Pro without a subscription", async () => {
    expect(await billing.planOf(await newUser("friend@example.com"))).toBe("pro");
  });

  it("sets an avatar's replies from its account's plan, and pauses it without one", async () => {
    const user = await newUser();
    const owned = (await db.createAvatar(user.id)).record;
    const unowned = (await db.createAvatar()).record;
    expect(await usage.replyAllowance(owned)).toEqual({ limit: 0, used: 0, paused: true });
    expect(await usage.overLimit(owned)).toBe(true);
    expect(usage.limitMessage(owned, await usage.replyAllowance(owned))).toMatch(/taking a break/);
    // Avatars from before accounts keep the configured default.
    expect(await usage.replyAllowance(unowned)).toEqual({ limit: config.limits.monthlyReplies, used: 0, paused: false });

    fakeStripe({ "checkout/sessions/cs_test_12345678": paidSession(user.id, subscription(user.id)) });
    await billing.confirmCheckout(user, "cs_test_12345678");
    expect(await usage.replyAllowance(owned)).toEqual({ limit: 300, used: 0, paused: false });
    expect(await usage.overLimit(owned)).toBe(false);

    // The allowance is the account's: replies by one avatar count for the others too.
    const second = (await db.createAvatar(user.id)).record;
    await db.updateAvatar(second.id, (r) => {
      r.usage = { month: usage.currentMonth(), replies: 299, total: 299 };
    });
    expect((await usage.replyAllowance(owned)).used).toBe(299);
    await usage.countReply(owned.id);
    expect(await usage.overLimit((await db.getAvatar(owned.id))!)).toBe(true);
    expect(await usage.overLimit((await db.getAvatar(second.id))!)).toBe(true);
    expect(usage.limitMessage(owned, await usage.replyAllowance(owned))).toMatch(/rest my voice/);
  });

  it("lets a 3D build start only once it is paid for", async () => {
    const user = await newUser();
    expect(billing.buildNeedsPayment()).toBe(true);
    await expect(billing.requireBuildAllowance(user, false)).rejects.toMatchObject({ status: 402, message: expect.stringMatching(/Creator plan/) });
    // Not even a retry of a failed build is free without a plan.
    await expect(billing.requireBuildAllowance(user, true)).rejects.toMatchObject({ status: 402 });

    fakeStripe({ "checkout/sessions/cs_test_12345678": paidSession(user.id, subscription(user.id)) });
    await billing.confirmCheckout(user, "cs_test_12345678");
    // Creator includes two builds a month; each one started is counted against the account.
    for (let i = 0; i < 2; i++) {
      expect(await billing.requireBuildAllowance(user, false)).toBe(user.id);
      await billing.countBuild(user.id);
    }
    await expect(billing.requireBuildAllowance(user, false)).rejects.toMatchObject({ status: 402, message: expect.stringMatching(/used all 2/) });
    // A retry after a failed build isn't counted, and next month starts afresh.
    expect(await billing.requireBuildAllowance(user, true)).toBeNull();
    const nextMonth = new Date(Date.now() + 32 * 24 * 60 * 60 * 1000);
    expect(await billing.requireBuildAllowance(user, false, nextMonth)).toBe(user.id);
  });

  it("gives no free builds on a live site that has no payments set up", async () => {
    const user = await newUser();
    const key = config.stripe.secretKey;
    config.stripe.secretKey = undefined;
    try {
      // A development server with payments off builds for free.
      vi.stubEnv("NODE_ENV", "development");
      expect(billing.buildNeedsPayment()).toBe(false);
      // A live one doesn't: there is no way to pay, so there is no build.
      vi.stubEnv("NODE_ENV", "production");
      expect(billing.buildNeedsPayment()).toBe(true);
      await expect(billing.requireBuildAllowance(user, false)).rejects.toMatchObject({ status: 503, message: expect.stringMatching(/payments are set up/) });
      // Accounts given a plan by hand can still build, for testing a deployment.
      expect(await billing.requireBuildAllowance(await newUser("friend@example.com"), false)).toMatch(/^u_/);
    } finally {
      config.stripe.secretKey = key;
      vi.unstubAllEnvs();
    }
  });
});
