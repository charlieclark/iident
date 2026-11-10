import type { Metadata } from "next";
import { Suspense } from "react";
import { Pricing } from "@/components/billing/Pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Design your character free. A plan builds it in 3D, gives it your voice and puts it on a link anyone can talk to.",
};

export default function PricingPage() {
  return (
    <Suspense>
      <Pricing />
    </Suspense>
  );
}
