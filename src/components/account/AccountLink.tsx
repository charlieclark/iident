"use client";

import Link from "next/link";
import { useAccount } from "@/lib/client/account";

const linkClass = "rounded-full px-3 py-2 text-sm font-medium text-ink-700 transition hover:bg-ink-100";

/** Header link: "Sign in" for visitors, "Your avatars" once signed in. `next` is where sign-in returns to. */
export function AccountLink({ next }: { next?: string }) {
  const { account } = useAccount();
  if (!account) return <span className="h-9 w-20" aria-hidden />;
  if (account.user) {
    return (
      <Link href="/me" className={linkClass}>
        Your avatars
      </Link>
    );
  }
  return (
    <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className={linkClass}>
      Sign in
    </Link>
  );
}
