import type { Metadata } from "next";
import { Suspense } from "react";
import { CheckoutReturn } from "@/components/billing/CheckoutReturn";

export const metadata: Metadata = { title: "Your plan", robots: { index: false } };

export default function BillingReturnPage() {
  return (
    <Suspense>
      <CheckoutReturn />
    </Suspense>
  );
}
