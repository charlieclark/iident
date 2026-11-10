/**
 * What each plan includes. Limits follow the costs in docs/go-to-market.md:
 * a 3D build is about $2.36 and a reply to a visitor 1 to 2 cents, so those
 * are what a plan meters. Designing a character (sketches and the final
 * image) costs cents and is free.
 */

export type PlanId = "free" | "creator" | "pro";
export type PaidPlanId = Exclude<PlanId, "free">;

export type Plan = {
  id: PlanId;
  name: string;
  /** US dollars a month. */
  price: number;
  /** Avatars that can be live (published) at once. */
  avatars: number;
  /** Replies to visitors per calendar month, shared by the account's avatars. */
  replies: number;
  /** 3D builds per calendar month, across the account. */
  builds: number;
  tagline: string;
  features: string[];
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    price: 0,
    avatars: 0,
    replies: 0,
    builds: 0,
    tagline: "Design your character.",
    features: ["Turn a selfie into your character", "Try unlimited looks and outfits", "Saved to your account"],
  },
  creator: {
    id: "creator",
    name: "Creator",
    price: 10,
    avatars: 1,
    replies: 300,
    builds: 2,
    tagline: "Bring it to life and share it.",
    features: [
      "1 live 3D avatar with its own link",
      "Speaks in your cloned voice",
      "300 replies to visitors a month",
      "Cards for your links, products and videos",
      "Custom background",
      "2 builds in 3D a month",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 29,
    avatars: 3,
    replies: 2000,
    builds: 5,
    tagline: "For busier pages and more than one avatar.",
    features: ["3 live 3D avatars", "2,000 replies to visitors a month", "5 builds in 3D a month", "Everything in Creator"],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "creator", "pro"];

export const isPaidPlan = (id: unknown): id is PaidPlanId => id === "creator" || id === "pro";
