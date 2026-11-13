/**
 * What the site calls itself and who is behind it, for the footer and the
 * Terms and Privacy pages. Set these in the environment before launch; the
 * pages leave out what isn't set.
 */
export const SITE = {
  name: "Twiins",
  /** The person or company that runs the site and is the other party to the Terms. */
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME?.trim() || "Twiins",
  /** Where people write about their data, a takedown or a bill. */
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "",
  /** Whose law the Terms are under, e.g. "the State of California, USA". */
  jurisdiction: process.env.NEXT_PUBLIC_LEGAL_JURISDICTION?.trim() || "",
  /** When the Terms and the Privacy page last changed. */
  legalUpdated: "November 13, 2026",
};
