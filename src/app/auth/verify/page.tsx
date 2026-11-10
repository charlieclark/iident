import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifySignIn } from "@/components/account/VerifySignIn";

// The token is in the URL: keep it out of referrers sent to other sites.
export const metadata: Metadata = { title: "Sign in", robots: { index: false }, referrer: "no-referrer" };

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifySignIn />
    </Suspense>
  );
}
