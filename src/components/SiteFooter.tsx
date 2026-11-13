import Link from "next/link";
import { SITE } from "@/lib/site";

/** The small print at the bottom of the site's own pages. */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={`mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-8 text-xs text-ink-500 sm:px-6 ${className ?? "max-w-6xl"}`}>
      <span>Only create avatars of yourself, or of people who have given you permission.</span>
      <nav aria-label="Legal" className="flex gap-4">
        <Link href="/terms" className="hover:text-ink-800 hover:underline">
          Terms
        </Link>
        <Link href="/privacy" className="hover:text-ink-800 hover:underline">
          Privacy
        </Link>
        {SITE.contactEmail && (
          <a href={`mailto:${SITE.contactEmail}`} className="hover:text-ink-800 hover:underline">
            Contact
          </a>
        )}
      </nav>
    </footer>
  );
}
