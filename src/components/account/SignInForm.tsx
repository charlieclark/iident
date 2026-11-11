"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Card, Logo, Notice } from "@/components/ui";
import { rememberNext, safeNext, useAccount } from "@/lib/client/account";
import { api } from "@/lib/client/api";

/** Asks for an email and sends a one-time sign-in link to it. */
export function SignInForm() {
  const params = useSearchParams();
  const router = useRouter();
  const { account } = useAccount();
  const next = safeNext(params.get("next"));
  /** Sent here by the creator, which needs an account before anything is made. */
  const starting = !!next?.startsWith("/create");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; devLink?: string } | null>(null);

  // Already signed in: nothing to do here.
  useEffect(() => {
    if (account?.user) router.replace(next ?? "/me");
  }, [account, next, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      rememberNext(next);
      const res = await api.startSignIn(email);
      setSent({ email: email.trim(), devLink: res.devLink });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <Link href="/" aria-label="iident home" className="mb-8 self-center">
        <Logo />
      </Link>
      <Card className="p-6 sm:p-8">
        {sent ? (
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Check your email</h1>
            <p className="mt-2 text-sm text-ink-600">
              <span>{sent.devLink ? "Your sign-in link for " : "We sent a sign-in link to "}</span>
              <span className="font-medium text-ink-900">{sent.email}</span>
              <span>{sent.devLink ? " is below." : "."} It works once and expires in 20 minutes.</span>
            </p>
            {sent.devLink && (
              <div className="mt-5">
                <Notice tone="warn">
                  <span>No email service is set up, so nothing was sent. </span>
                  <a href={sent.devLink} className="font-medium underline">
                    Open the sign-in link
                  </a>
                </Notice>
              </div>
            )}
            <button type="button" onClick={() => setSent(null)} className="mt-5 text-sm font-medium text-accent-700 hover:underline">
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit}>
            <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{starting ? "Create your account to start" : "Sign in to iident"}</h1>
            <p className="mt-2 text-sm text-ink-600">
              {starting
                ? "Your avatar is saved to your account as you make it. Enter your email and we'll send you a link: no password. Already have an account? The same link signs you in."
                : "Enter your email and we'll send you a link. No password. New here? The same link creates your account."}
            </p>
            <label className="mt-5 block">
              <span className="text-sm font-medium text-ink-800">Email</span>
              <input
                type="email"
                required
                autoFocus
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1.5 h-11 w-full rounded-xl border border-ink-200 bg-white px-3.5 text-base text-ink-900 outline-none transition placeholder:text-ink-400 focus:border-accent-400 focus:ring-2 focus:ring-accent-100"
              />
            </label>
            {error && (
              <div className="mt-3">
                <Notice tone="error">{error}</Notice>
              </div>
            )}
            <Button type="submit" size="lg" className="mt-5 w-full" loading={busy}>
              {starting ? "Email me a link to start" : "Email me a sign-in link"}
            </Button>
            <p className="mt-4 text-xs text-ink-500">Avatars you&apos;ve started in this browser are added to your account when you sign in.</p>
          </form>
        )}
      </Card>
    </div>
  );
}
