import Image from "next/image";
import Link from "next/link";
import { AccountLink } from "@/components/account/AccountLink";
import { ContinueDraft } from "@/components/ContinueDraft";
import { Logo } from "@/components/ui";

const STEPS = [
  { title: "Snap a selfie", body: "One clear photo is enough to capture your likeness." },
  { title: "Try on looks", body: "See yourself sketched in seconds as you change hair and outfits, then get a final character that really looks like you." },
  { title: "Lend it your voice", body: "Read a short script and your avatar speaks with a clone of your voice." },
  { title: "Share one link", body: "Give it a persona. Anyone with the link can talk to your 3D twin." },
];

export default function Home() {
  return (
    <div className="min-h-dvh overflow-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <AccountLink />
          <Link href="/create" className="rounded-full bg-ink-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-ink-800">
            Create yours
          </Link>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-6 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pt-14">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1 text-xs font-medium text-accent-700">
              <span className="size-1.5 rounded-full bg-accent-500" /> Selfie to talking 3D avatar
            </p>
            <h1 className="mt-5 text-5xl font-semibold leading-[1.02] tracking-tight text-ink-900 sm:text-6xl">
              Your 3D twin.
              <br />
              <span className="text-accent-500">Your voice.</span> One link.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink-600">
              Upload a selfie, record a few sentences and choose your look. We build a 3D character that looks like you,
              speaks like you and chats with anyone who opens your link.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/create"
                className="inline-flex h-12 items-center rounded-full bg-accent-500 px-7 text-base font-medium text-white shadow-soft transition hover:bg-accent-600"
              >
                Create your avatar
              </Link>
              <ContinueDraft />
            </div>
            <p className="mt-4 text-xs text-ink-500">Takes about 10 minutes. Visitors always see that they&apos;re talking to an AI.</p>
          </div>

          <div className="relative mx-auto h-[460px] w-full max-w-[460px] sm:h-[540px]">
            <div className="absolute inset-x-6 bottom-0 top-10 rounded-[3rem] bg-gradient-to-b from-accent-100 via-peach-100 to-paper" />
            <Image
              src="/examples/house-2.webp"
              alt="Example avatar"
              width={453}
              height={1000}
              preload
              className="absolute bottom-6 left-2 h-[80%] w-auto animate-float drop-shadow-xl"
            />
            <Image
              src="/examples/house-1.webp"
              alt="Example avatar"
              width={462}
              height={1000}
              preload
              className="absolute bottom-0 right-4 h-[90%] w-auto animate-float drop-shadow-xl [animation-delay:-3s]"
            />
            <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-2xl bg-card px-4 py-2.5 text-sm shadow-lift">
              <span className="text-ink-500">Visitor:</span> What are you working on lately?
            </div>
          </div>
        </section>

        <section className="border-t border-ink-100 bg-card/60">
          <div className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title}>
                <span className="grid size-8 place-items-center rounded-full bg-ink-900 text-sm font-semibold text-white">{i + 1}</span>
                <h2 className="mt-3 font-semibold text-ink-900">{s.title}</h2>
                <p className="mt-1 text-sm text-ink-600">{s.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs text-ink-400 sm:px-6">
        Only create avatars of yourself, or of people who have given you permission.
      </footer>
    </div>
  );
}
