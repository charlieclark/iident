import type { Metadata } from "next";
import Link from "next/link";
import { Contact, Legal, Section } from "@/components/Legal";
import { RETENTION } from "@/lib/retention";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Terms", description: "The terms for using Aliike." };

// A plain-language draft that follows what the product does. Have it reviewed
// by a lawyer before launch, and set NEXT_PUBLIC_LEGAL_NAME,
// NEXT_PUBLIC_CONTACT_EMAIL and NEXT_PUBLIC_LEGAL_JURISDICTION.
//
// Every statement about how the product behaves (billing, limits, deleting,
// takedowns) is matched to the code. When that behaviour changes, change the
// sentence here in the same pull request and update SITE.legalUpdated.
export default function TermsPage() {
  return (
    <Legal
      title="Terms"
      intro={
        <>
          <p>
            Aliike turns a photo into a talking 3D avatar with a voice you pick and a personality you write, at a link you can share. These terms are the agreement
            between you and {SITE.legalName} (&quot;we&quot;, &quot;us&quot;) for using it.
          </p>
          <p>
            You agree to them when you create an account. If you only talk to someone else&apos;s avatar, the sections &quot;What is not allowed&quot;, &quot;It
            is an AI&quot;, &quot;No guarantees and limits on liability&quot; and &quot;The rest&quot; apply to you. How we handle personal data is set out in
            the <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </>
      }
    >
      <Section title="Who can use Aliike">
        <ul>
          <li>You must be 18 or older.</li>
          <li>An account belongs to one person and is tied to one email address. The details you give us must be true.</li>
          <li>
            You sign in with a link we email you, so anyone who can read your email can get into your account. Keep your email secure, and tell us at once if
            someone has used your account without your permission.
          </li>
          <li>You are responsible for what is done through your account.</li>
        </ul>
      </Section>

      <Section title="Your photo and your avatar">
        <ul>
          <li>
            <strong>Only yourself, or an adult who agreed.</strong> Make an avatar only from a photo of yourself, or of a person aged 18 or over who has
            clearly agreed to it and knows what it will be used for. You confirm this each time you upload a photo. We may ask you to show that agreement,
            and we will remove the avatar if that person asks us to.
          </li>
          <li>
            <strong>Your consent.</strong> By uploading a photo you agree that we process the face in it to make the avatar, as the Privacy Policy
            describes. You can withdraw that agreement at any time by deleting the avatar.
          </li>
          <li>
            <strong>It stays yours.</strong> Your photo, what you write and the avatar made from them remain yours. You give us permission to store, copy,
            adapt and process them, to send them to the companies named in the Privacy Policy, and to show the published avatar to anyone who opens its
            link. That permission covers running Aliike for you and nothing else. It ends when you delete the avatar or your account.
          </li>
          <li>
            <strong>The voice is not yours.</strong> Your avatar speaks in a ready-made voice that you pick. We do not record or copy anyone&apos;s voice.
          </li>
          <li>
            <strong>What you add must be yours to add.</strong> The text, links, pictures, videos and products you give your avatar must be yours, or used with
            the right to use them.
          </li>
          <li>
            <strong>You are responsible for it.</strong> You decide what your avatar knows, how it speaks and whether it is published. What it says to visitors
            is said on your behalf.
          </li>
        </ul>
      </Section>

      <Section title="What is not allowed">
        <ul>
          <li>Making an avatar of anyone under 18, or of anyone who has not agreed to it.</li>
          <li>Making an avatar that pretends to be a real person, a public figure, a company or an official body that is not behind it.</li>
          <li>Using an avatar to deceive, defraud, harass, threaten or stalk anyone, or to hide that it is an AI when someone asks.</li>
          <li>Presenting an avatar as giving medical, legal or financial advice that people should act on.</li>
          <li>Sexual content, content that sexualises minors in any way, or content that promotes violence, self-harm or hatred of a group of people.</li>
          <li>Anything unlawful, or that infringes someone else&apos;s copyright, trademark, privacy or right to their own likeness.</li>
          <li>Spam, or links to malware or scams.</li>
          <li>
            Breaking or working around the service: its limits, its payment or its security; copying, scraping or reverse engineering it; automated use that
            overloads it; reselling it without our written agreement.
          </li>
          <li>Trying to make someone else&apos;s avatar say something harmful, or to get private information out of it.</li>
        </ul>
      </Section>

      <Section title="Reports and takedowns">
        <ul>
          <li>Every avatar page has a Report link. Anyone can use it, with or without an account, and we look at what is reported.</li>
          <li>
            We can take an avatar down, limit it or close an account, at once and without warning, when we believe it breaks these terms or the law, or puts
            someone at risk. A taken-down avatar&apos;s page stops working and it cannot be published again unless we restore it.
          </li>
          <li>If we took something of yours down and you think that was a mistake, write to us and a person will look at it again.</li>
          <li>We may pass information to the authorities where the law requires it or where we believe someone is in danger.</li>
        </ul>
      </Section>

      <Section title="It is an AI">
        <ul>
          <li>Avatars answer with the help of AI models. They can be wrong, make things up, or say something the person they represent would not.</li>
          <li>Avatar pages are labelled as AI, and an avatar is told to say it is an AI when asked.</li>
          <li>
            What an avatar says is not professional advice and is not a promise, an offer or an agreement from the person it represents. Do not rely on it for
            decisions that matter.
          </li>
          <li>The character is drawn and built by AI models from your photo. It is a stylised likeness, not an exact copy of you.</li>
        </ul>
      </Section>

      <Section title="Plans and payment">
        <ul>
          <li>
            Designing a character is free with an account. Building it in 3D and publishing it need a paid plan. Prices and what each plan includes are on the{" "}
            <Link href="/pricing">pricing page</Link>. Taxes may be added where they apply.
          </li>
          <li>
            Plans are paid monthly in advance through Stripe and <strong>renew automatically every month until you cancel</strong>. You can cancel at any time
            from your account page, which stops further renewals.
          </li>
          <li>
            Payments for a period that has started are not refunded, except where the law gives you that right. Deleting your account ends your plan at once,
            without a refund for the rest of the period.
          </li>
          <li>
            Each plan has limits on live avatars, on 3D builds and on replies to visitors. Builds and replies are counted per calendar month (UTC) and what you
            do not use does not carry over. A build that fails is not counted when you try again.
          </li>
          <li>When your avatars reach the month&apos;s reply limit, they give visitors a short notice in place of a reply until the next month or until you move to a larger plan.</li>
          <li>If a payment fails, Stripe tries again for a time. If it still fails, the plan ends.</li>
          <li>When a plan ends, your avatars are kept but paused: their pages stay up and give a short notice in place of replies until you have a plan again.</li>
          <li>
            We may change prices or what a plan includes. A change applies from your next renewal at the earliest, and we will email you at least 30 days before
            it does.
          </li>
        </ul>
      </Section>

      <Section title="Ending things">
        <ul>
          <li>
            You can delete an avatar, or your whole account, from your account page at any time. What deleting removes is described in the{" "}
            <Link href="/privacy">Privacy Policy</Link>.
          </li>
          <li>
            An account with no paid plan that nobody has signed in to for {RETENTION.inactiveMonths} months is deleted, with everything in it,{" "}
            {RETENTION.warningDays} days after we email its owner. Signing in before then keeps it.
          </li>
          <li>We can suspend or close an account that breaks these terms, that is used to harm others, or whose payments fail. No refund is due in those cases.</li>
          <li>
            If we close your account for any other reason, or stop offering Aliike, we will tell you by email first where we can and refund the part of your
            current paid period that you could not use.
          </li>
          <li>The sections on liability, on claims caused by your avatar and on the rest continue to apply after an account is closed.</li>
        </ul>
      </Section>

      <Section title="What is ours">
        <p>
          The Aliike software, its design, its name and the ready-made artwork in it belong to us. These terms let you use Aliike; they do not give you any
          rights in it. We may add, change or remove features, and parts of the service depend on other companies&apos; AI models, which can change or stop.
        </p>
      </Section>

      <Section title="No guarantees and limits on liability">
        <ul>
          <li>
            Aliike is provided as it is. We work to keep it running and correct, but we do not promise that it will always be available, that an avatar will
            look or sound exactly like you, or that its answers will be accurate.
          </li>
          <li>
            To the extent the law allows, we are not liable for indirect or consequential losses, for lost profits, revenue or data, or for what an avatar says
            to anyone.
          </li>
          <li>
            To the extent the law allows, our total liability to you for everything connected with Aliike is limited to the larger of what you paid us in the
            twelve months before the claim and 100 US dollars.
          </li>
          <li>
            Nothing in these terms limits liability that cannot be limited by law, such as for fraud or for death or injury caused by negligence, or takes away
            rights you have as a consumer under the law where you live.
          </li>
        </ul>
      </Section>

      <Section title="Claims caused by your avatar">
        <p>
          If someone brings a claim against us because of an avatar you made, what you gave it, or your breaking these terms, you will cover our reasonable
          costs and losses from that claim, to the extent the law allows. We will tell you about the claim promptly.
        </p>
      </Section>

      <Section title="Changes to these terms">
        <p>
          We may update these terms as the product changes. For a change that affects your rights or what you pay, we will email you at least 30 days before it
          takes effect. If you do not agree, you can delete your account before then. Using Aliike after a change takes effect means you accept it.
        </p>
      </Section>

      <Section title="The rest">
        <ul>
          {SITE.jurisdiction && (
            <li>
              These terms are governed by the laws of {SITE.jurisdiction}, and disputes go to the courts there. If you are a consumer, you keep the protection of
              the mandatory laws of the place where you live and may bring a claim in its courts.
            </li>
          )}
          <li>These terms and the Privacy Policy are the whole agreement between you and us about Aliike.</li>
          <li>If a court finds part of these terms invalid, the rest still applies.</li>
          <li>If we do not act on a breach straight away, we can still act on it later.</li>
          <li>You may not pass this agreement to someone else. We may pass it to a company that takes over Aliike, and will tell you if we do.</li>
          <li>We send notices to your account&apos;s email address.</li>
        </ul>
      </Section>

      <Section title="Contact">
        <Contact about="about these terms" />
      </Section>
    </Legal>
  );
}
