"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Button, Card, Logo, Notice } from "@/components/ui";
import { takeNext } from "@/lib/client/account";
import { api } from "@/lib/client/api";

/**
 * Where a sign-in link lands. Signing in takes a click so that mail scanners
 * that open links in advance don't use the link up.
 */
export function VerifySignIn() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(token ? null : "This sign-in link is incomplete. Ask for a new one.");

  async function signIn() {
    if (!token) return;
    setBusy(true);
    try {
      await api.finishSignIn(token);
      // Bring along whatever this browser made before the account existed.
      await api.claimDrafts().catch(() => {});
      router.replace(takeNext() ?? "/me");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" aria-label="iident home" className="mb-8 self-center">
        <Logo />
      </Link>
      <Card className="p-6 text-center sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Finish signing in</h1>
        {error ? (
          <>
            <div className="mt-4 text-left">
              <Notice tone="error">{error}</Notice>
            </div>
            <Link href="/login" className="mt-5 inline-block text-sm font-medium text-accent-700 hover:underline">
              Get a new link
            </Link>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-ink-600">One click and you&apos;re in.</p>
            <Button size="lg" className="mt-5 w-full" loading={busy} onClick={signIn}>
              Sign in
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}
