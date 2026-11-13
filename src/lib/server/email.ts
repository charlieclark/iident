import "server-only";
import { config } from "./config";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

type Email = { to: string | string[]; subject: string; /** Plain paragraphs. */ lines: string[]; /** A link shown as a button-like line. */ link?: { label: string; url: string } };

/**
 * Sends an email through Resend. With no email service configured nothing is
 * sent and the result is false.
 */
async function send({ to, subject, lines, link }: Email): Promise<boolean> {
  if (!config.email.resendKey) return false;
  const text = [...lines.slice(0, 1), ...(link ? [link.url] : []), ...lines.slice(1)].join("\n\n");
  const html = [
    ...lines.slice(0, 1).map((l) => `<p>${escapeHtml(l)}</p>`),
    ...(link ? [`<p><a href="${escapeHtml(link.url)}">${escapeHtml(link.label)}</a></p>`] : []),
    ...lines.slice(1).map((l) => `<p>${escapeHtml(l)}</p>`),
  ].join("");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.email.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from: config.email.from, to: Array.isArray(to) ? to : [to], subject, text, html }),
  });
  if (!res.ok) throw new Error(`Email "${subject}" could not be sent (${res.status})`);
  return true;
}

/**
 * Sends the sign-in link. With no email service configured the link is only
 * logged, and `delivered` is false so development pages can show it instead.
 */
export async function sendSignInEmail(to: string, link: string): Promise<{ delivered: boolean }> {
  if (!config.email.resendKey) {
    console.info(`Sign-in link for ${to}: ${link}`);
    return { delivered: false };
  }
  await send({
    to,
    subject: "Your Twiins sign-in link",
    lines: ["Open this link to sign in to Twiins:", "It works once and expires in 20 minutes. If you didn't ask for it, you can ignore this email."],
    link: { label: "Sign in to Twiins", url: link },
  });
  return { delivered: true };
}

/** Tells a creator their 3D avatar finished building (it takes minutes, and they may have closed the page). */
export function sendAvatarReadyEmail(to: string, name: string, link: string): Promise<boolean> {
  const who = name.trim() || "Your avatar";
  return send({
    to,
    subject: `${who} is ready`,
    lines: [`${who} has been built in 3D and is ready for its voice and personality.`, "You're getting this because you started a build on Twiins."],
    link: { label: "Open your avatar", url: link },
  });
}

/** Tells a creator their build didn't work, and that trying again is free. */
export function sendBuildFailedEmail(to: string, name: string, link: string): Promise<boolean> {
  const who = name.trim() || "your avatar";
  return send({
    to,
    subject: "Your 3D build didn't finish",
    lines: [`Something went wrong while building ${who} in 3D. Trying again doesn't count against your plan.`, "You're getting this because you started a build on Twiins."],
    link: { label: "Try again", url: link },
  });
}

/** Tells the site's owners that an avatar was reported. */
export function sendReportEmail(to: string[], report: { slug: string; reason: string; details: string }, link: string): Promise<boolean> {
  return send({
    to,
    subject: `Reported: /a/${report.slug} (${report.reason})`,
    lines: [`The avatar at /a/${report.slug} was reported for: ${report.reason}.`, ...(report.details ? [`"${report.details}"`] : [])],
    link: { label: "Review it", url: link },
  });
}
