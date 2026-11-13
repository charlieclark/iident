import type { Metadata } from "next";
import { Contact, Legal, Section } from "@/components/Legal";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", description: "What Twiins collects, why, and how to delete it." };

// A plain-language draft that follows what the code does (see src/lib/server).
// Have it reviewed by a lawyer before launch: face and voice data are treated
// as biometric data in some places, which brings specific duties.
export default function PrivacyPage() {
  return (
    <Legal
      title="Privacy Policy"
      intro={
        <p>
          To make your avatar we need your face and your voice, which are about as personal as data gets. This page says what {SITE.legalName} (&quot;we&quot;)
          collects, what it is used for, who else handles it, and how you delete it.
        </p>
      }
    >
      <Section title="What we collect">
        <ul>
          <li>
            <strong>Your account:</strong> your email address.
          </li>
          <li>
            <strong>Your photo,</strong> and what we make from it: a cleaned-up portrait, drawings of your character, and its 3D model.
          </li>
          <li>
            <strong>Your voice recording,</strong> if you choose to clone your voice, and a transcript of it.
          </li>
          <li>
            <strong>What you write for your avatar:</strong> its name, personality, what it knows, and the links and items it can show.
          </li>
          <li>
            <strong>Payment details,</strong> handled by Stripe. We see your plan and its status, never your card number.
          </li>
          <li>
            <strong>How the service is used:</strong> the steps you take while creating (so we can see where people get stuck), how many replies your avatar gives
            each month, and errors, including errors that happen in your browser.
          </li>
        </ul>
      </Section>

      <Section title="Your face and your voice">
        <p>
          We use your photo and your recording for one thing: making your avatar and letting it speak. We ask for your agreement when you upload each of them. We
          do not use them to identify people, we do not sell them, and we do not use them to train AI models.
        </p>
      </Section>

      <Section title="People who talk to an avatar">
        <p>
          You don&apos;t need an account to talk to a published avatar. What you type or say is sent to the AI services below to produce the reply and the speech,
          and we do not keep it. To limit abuse we count requests per network address, stored only in a scrambled form that cannot be turned back into the
          address.
        </p>
        <p>
          If you report an avatar, we keep what you wrote and, if you give it, your email address, so that we can look into it and answer you.
        </p>
      </Section>

      <Section title="Who else handles your data">
        <p>We use other companies to run parts of the service. Each receives only what its part needs:</p>
        <ul>
          <li>
            <strong>fal.ai</strong> and the image and 3D models it runs: your photo, to draw your character and build its 3D model; voice messages, to turn them
            into text.
          </li>
          <li>
            <strong>Anthropic:</strong> what your avatar is told about itself and the conversation, to write its replies.
          </li>
          <li>
            <strong>ElevenLabs and Fish Audio:</strong> the text to be spoken and, if you cloned your voice, your recording, to produce speech.
          </li>
          <li>
            <strong>Stripe:</strong> payments.
          </li>
          <li>
            <strong>Resend:</strong> the emails we send you (sign-in links, and a note when a 3D build finishes).
          </li>
          <li>
            <strong>Vercel</strong> and our database provider: hosting, stored files and records.
          </li>
        </ul>
        <p>Some of these companies are outside your country. We do not share your data with anyone else, and we show no ads.</p>
      </Section>

      <Section title="Cookies">
        <p>
          One cookie keeps you signed in. Your browser also remembers which avatars you were working on. There are no advertising cookies and no third-party
          analytics.
        </p>
      </Section>

      <Section title="Deleting, and how long we keep things">
        <p>We keep your data for as long as you keep your avatar or your account. You can delete either from your account page, at any time:</p>
        <ul>
          <li>
            <strong>Deleting an avatar</strong> removes its photo, portrait, drawings, 3D model, voice recording and voice clone, and its page stops existing.
          </li>
          <li>
            <strong>Deleting your account</strong> does that for every avatar, ends your plan, signs you out everywhere and removes your email address from our
            records.
          </li>
        </ul>
        <p>
          Copies that the companies above hold for processing are removed on their own schedules, which we do not control. Stripe keeps payment records as the law
          requires. Counts of what happened on the site are kept without your identity.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Depending on where you live, you may have the right to see the data we hold about you, to have it corrected or deleted, to receive a copy, or to object
          to how it is used. Deleting is in your account page. For anything else, contact us and we will answer within 30 days.
        </p>
      </Section>

      <Section title="Age">
        <p>Twiins is for people aged 18 and over. We do not knowingly collect data from anyone younger.</p>
      </Section>

      <Section title="Changes and contact">
        <p>If we change what we collect or who handles it, we will update this page and, for changes that matter, tell you by email.</p>
        <Contact about="about your data" />
      </Section>
    </Legal>
  );
}
