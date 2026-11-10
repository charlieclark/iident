import "server-only";
import { config } from "./config";

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Sends the sign-in link. With no email service configured the link is only
 * logged, and `delivered` is false so development pages can show it instead.
 */
export async function sendSignInEmail(to: string, link: string): Promise<{ delivered: boolean }> {
  if (!config.email.resendKey) {
    console.info(`Sign-in link for ${to}: ${link}`);
    return { delivered: false };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${config.email.resendKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: config.email.from,
      to: [to],
      subject: "Your iident sign-in link",
      text: `Open this link to sign in to iident:\n\n${link}\n\nIt works once and expires in 20 minutes. If you didn't ask for it, you can ignore this email.`,
      html: `<p>Open this link to sign in to iident:</p><p><a href="${escapeHtml(link)}">Sign in to iident</a></p><p>It works once and expires in 20 minutes. If you didn't ask for it, you can ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`Sign-in email could not be sent (${res.status})`);
  return { delivered: true };
}
