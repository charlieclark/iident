import { handleWebhookEvent, verifyWebhook } from "@/lib/server/billing";
import { config, HttpError } from "@/lib/server/config";
import { handle } from "@/lib/server/http";

/**
 * Stripe webhook: keeps plans in step with renewals, cancellations and
 * failed payments. Point Stripe at /api/billing/webhook with the events
 * checkout.session.completed and customer.subscription.created/updated/deleted.
 */
export const POST = handle(async (req: Request) => {
  if (!config.stripe.webhookSecret) throw new HttpError(503, "Webhooks aren't set up.");
  // The signature covers the exact bytes, so read the body as text before parsing.
  const raw = await req.text();
  if (!verifyWebhook(raw, req.headers.get("stripe-signature"), config.stripe.webhookSecret)) {
    throw new HttpError(400, "Invalid signature.");
  }
  await handleWebhookEvent(JSON.parse(raw));
  return Response.json({ received: true });
});
