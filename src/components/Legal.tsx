import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/SiteFooter";
import { Logo } from "@/components/ui";
import { SITE } from "@/lib/site";

/** The frame of the Terms and Privacy pages: plain, readable text. */
export function Legal({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-4 py-5 sm:px-6">
        <Link href="/" aria-label="Twiins home">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-10 pt-4 sm:px-6">
        <h1 className="text-3xl font-semibold tracking-tight text-ink-900 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-ink-500">Last updated {SITE.legalUpdated}</p>
        <div className="mt-6 text-[15px] leading-relaxed text-ink-700">{intro}</div>
        <div className="mt-2 space-y-8">{children}</div>
      </main>
      <SiteFooter className="max-w-3xl" />
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
      <div className="mt-2 space-y-3 text-[15px] leading-relaxed text-ink-700 [&_a]:underline [&_li]:ml-5 [&_li]:list-disc [&_ul]:space-y-1.5">{children}</div>
    </section>
  );
}

/** How to reach the people who run the site, where an address has been set. */
export function Contact({ about }: { about: string }) {
  if (!SITE.contactEmail) return <p>To reach us {about}, use the contact details on this site.</p>;
  return (
    <p>
      To reach us {about}, write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
    </p>
  );
}
