import type { Metadata } from "next";
import Link from "next/link";
import { Contact, Legal, Section } from "@/components/Legal";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms", description: "The terms for using Twiins." };

// A plain-language draft that follows what the product does. Have it reviewed
// by a lawyer before launch, and set NEXT_PUBLIC_LEGAL_NAME,
// NEXT_PUBLIC_CONTACT_EMAIL and NEXT_PUBLIC_LEGAL_JURISDICTION.
export default function TermsPage() {
  return (
    <Legal
      title="Terms"
      intro={
        <p>
          Twiins turns a photo and a voice recording into a talking 3D avatar with a personality, at a link you can share. These terms are the agreement between
          you and {SITE.legalName} (&quot;we&quot;) for using it. By creating an account you agree to them.
        </p>
      }
    >
      <Section title="Who can use Twiins">
        <p>You must be 18 or older. You sign in with your email address, and you are responsible for what happens in your account.</p>
      </Section>

      <Section title="Your avatar and what you give us">
        <ul>
          <li>
            <strong>Only yourself, or with permission.</strong> Make an avatar only from your own face and voice, or from those of an adult who has clearly agreed
            to it. You confirm this each time you upload a photo or a recording.
          </li>
          <li>
            <strong>It stays yours.</strong> Your photo, your recording, what you write and the avatar made from them remain yours. You give us permission to store
            and process them, and to show the published avatar to people who open its link, for as long as you keep it on Twiins. That is all we use them for.
          </li>
          <li>
            <strong>You are responsible for it.</strong> You decide what your avatar knows, how it speaks and whether it is published. What it says to visitors is
            said on your behalf.
          </li>
        </ul>
      </Section>

      <Section title="What is not allowed">
        <ul>
          <li>Making an avatar of someone without their permission, or one that pretends to be a real person who isn&apos;t behind it.</li>
          <li>Using an avatar to deceive, defraud, harass or threaten anyone, or to hide that it is an AI when someone asks.</li>
          <li>Anything unlawful, sexual content involving minors, or content that promotes violence or hatred.</li>
          <li>Breaking or working around the service: its limits, its payment, its security, or automated use that overloads it.</li>
        </ul>
        <p>
          We can take down an avatar or close an account that breaks these rules. Every avatar page has a Report link, and we look at what is reported. If we took
          something of yours down and you think that was a mistake, tell us.
        </p>
      </Section>

      <Section title="It is an AI">
        <p>
          Avatars answer with the help of AI models. They can be wrong, make things up, or say something their owner would not. Pages are labelled as AI avatars.
          Don&apos;t rely on what an avatar says for decisions that matter, and don&apos;t treat it as a promise from the person it represents.
        </p>
      </Section>

      <Section title="Plans and payment">
        <ul>
          <li>
            Designing a character is free with an account. Building it in 3D and publishing it need a paid plan. Prices and what each plan includes are on the{" "}
            <Link href="/pricing">pricing page</Link>.
          </li>
          <li>Plans are billed monthly in advance through Stripe and renew until you cancel. You can cancel at any time from your account.</li>
          <li>Payments for a period that has started are not refunded, except where the law says otherwise.</li>
          <li>When a plan ends, your avatars are kept but paused: their pages stay up and stop answering until you have a plan again.</li>
          <li>Each plan has monthly limits on 3D builds and on replies to visitors. We may change prices or limits for future periods and will tell you first.</li>
        </ul>
      </Section>

      <Section title="Deleting and closing">
        <p>
          You can delete an avatar, or your whole account, from your account page at any time. Deleting an account ends its plan at once. What deleting removes is
          described in the <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="No guarantees">
        <p>
          Twiins is provided as it is. We work to keep it running and correct, but we do not promise that it will always be available, that an avatar will look or
          sound exactly like you, or that its answers will be accurate. To the extent the law allows, we are not liable for indirect or consequential losses, and
          our total liability to you is limited to what you paid us in the twelve months before the claim.
        </p>
      </Section>

      <Section title="Changes">
        <p>We may update these terms as the product changes. If a change matters to you, we will tell you by email or on the site before it takes effect.</p>
        {SITE.jurisdiction && <p>These terms are governed by the laws of {SITE.jurisdiction}.</p>}
      </Section>

      <Section title="Contact">
        <Contact about="about these terms" />
      </Section>
    </Legal>
  );
}
