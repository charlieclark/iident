import type { Metadata } from "next";
import { Contact, Legal, Section } from "@/components/Legal";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", description: "What Aliike collects, why, who else handles it, and how to delete it." };

// A plain-language draft that follows what the code does (see src/lib/server).
// Have it reviewed by a lawyer before launch: face and voice data are treated
// as biometric data in some places, which brings specific duties.
//
// Every statement here is matched to the code: what is stored, what each
// provider receives, how long things are kept. When that changes (a new
// provider, a new thing stored, a different lifetime), change the sentence
// here in the same pull request and update SITE.legalUpdated.
export default function PrivacyPage() {
  return (
    <Legal
      title="Privacy Policy"
      intro={
        <p>
          To make your avatar we need your face and your voice, which are about as personal as data gets. This page says what {SITE.legalName} (&quot;we&quot;)
          collects, what it is used for, who else handles it, how long it is kept and how you delete it. We are the party responsible for this data (the
          &quot;controller&quot;, in the words of European law).
        </p>
      }
    >
      <Section title="What we collect">
        <p>If you create an account:</p>
        <ul>
          <li>
            <strong>Your email address,</strong> and a record of your sign-ins. We keep sign-in links and sessions only as scrambled values that cannot be used
            to sign in.
          </li>
          <li>
            <strong>Your photo,</strong> and what is made from it: a cleaned-up portrait, drawings of your character, its 3D model and a thumbnail.
          </li>
          <li>
            <strong>Your voice recording,</strong> if you choose to clone your voice, with a transcript of it.
          </li>
          <li>
            <strong>What you choose and write for your avatar:</strong> its look, name, personality, what it knows, its background, and the links, pictures and
            products it can show.
          </li>
          <li>
            <strong>Your plan:</strong> which one, its status, and the identifiers Stripe gives us for you and your subscription. Stripe collects your card and
            billing details; we never see your card number.
          </li>
          <li>
            <strong>What you do while creating:</strong> a dated record of the steps you reach (signed up, uploaded a photo, previewed a look, started a build,
            published and so on), so that we can see where people get stuck. Also how many 3D builds you start and how many replies your avatars give each
            month.
          </li>
        </ul>
        <p>From everyone who uses the site, with or without an account:</p>
        <ul>
          <li>
            <strong>Errors.</strong> When a page breaks in your browser we record the error message, where in our code it happened and which page you were on.
          </li>
          <li>
            <strong>Your network address,</strong> briefly. Our hosting provider logs each request (address, browser type, page) for a short time. To limit
            abuse we also count requests per address, keeping only a scrambled form of the address, which is cleared once it has gone unused for a while.
          </li>
          <li>
            <strong>Reports.</strong> If you report an avatar we keep what you wrote and, if you give it, your email address.
          </li>
        </ul>
      </Section>

      <Section title="Your face and your voice">
        <p>
          A photo of your face and a recording of your voice, and the portrait, character and voice clone made from them, may count as biometric or specially
          protected data where you live. For these:
        </p>
        <ul>
          <li>
            <strong>We ask first.</strong> You tick a box agreeing before a photo is used, and again before a voice is cloned. If the face or voice belongs to
            someone else, you confirm that they agreed.
          </li>
          <li>
            <strong>One purpose.</strong> We use them to make your avatar, show it and let it speak. We do not use them to identify or recognise people, we do
            not sell them, we do not use them for advertising, and we do not use them to train AI models.
          </li>
          <li>
            <strong>Who sees them.</strong> Only you, and the companies listed below that do the drawing, building and speaking. The published avatar shows the
            3D character and speaks in the voice; your photo and your recording are never shown to visitors.
          </li>
          <li>
            <strong>Until you delete.</strong> We keep them until you delete the avatar or your account, and then remove them as described under
            &quot;Deleting&quot;. Deleting is how you withdraw your agreement.
          </li>
          <li>
            <strong>If it is your face or voice and you did not agree,</strong> use the Report link on the avatar&apos;s page or write to us, and we will take
            it down.
          </li>
        </ul>
      </Section>

      <Section title="What we use it for">
        <ul>
          <li>
            <strong>To provide the service you asked for:</strong> your account, your avatar, its conversations, your plan, and emails about them (sign-in
            links, and a note when a 3D build finishes or fails). We send no marketing email.
          </li>
          <li>
            <strong>With your agreement:</strong> processing the face and the voice, as described above.
          </li>
          <li>
            <strong>Because we have a legitimate interest in a service that works and is safe:</strong> counting the steps people reach, recording errors,
            limiting abuse, and handling reports and takedowns.
          </li>
          <li>
            <strong>Because the law requires it:</strong> keeping payment and tax records.
          </li>
        </ul>
        <p>We make no decisions about you by automated means that have legal or similarly significant effects.</p>
      </Section>

      <Section title="People who talk to an avatar">
        <ul>
          <li>You do not need an account to talk to a published avatar, and we do not ask who you are.</li>
          <li>
            What you type is sent to the AI services below to write the reply and speak it. If you send a voice message, the recording is sent to be turned into
            text. We do not store your messages, your recordings or the avatar&apos;s replies. The conversation lives in your browser and is gone when you close
            the page.
          </li>
          <li>
            The avatar&apos;s owner does not see what you said. We count how many replies each avatar gives, not what they contain.
          </li>
          <li>
            Do not tell an avatar anything private. It is an AI, and what you write is processed by the companies below.
          </li>
          <li>
            An avatar can show cards with pictures, videos and music from other sites, such as YouTube, Vimeo, TikTok or Spotify. Those load from the other
            site, which then sees your network address and may set its own cookies when you play them.
          </li>
        </ul>
      </Section>

      <Section title="Who else handles your data">
        <p>We use other companies to run parts of the service. Each receives only what its part needs:</p>
        <ul>
          <li>
            <strong>fal.ai,</strong> which runs or passes requests to image and 3D models, currently from OpenAI, Google, Black Forest Labs and Meshy: your
            photo and the pictures made from it, to draw your character and build its 3D model; visitors&apos; voice messages and your voice recording, to turn
            them into text.
          </li>
          <li>
            <strong>Anthropic:</strong> what your avatar is told about itself and the conversation so far, to write its replies.
          </li>
          <li>
            <strong>ElevenLabs and Fish Audio</strong> (or MiniMax, through fal.ai, when neither is available): the text to be spoken and, if you cloned your voice, your recording and its transcript, to produce
            speech. Where the provider stores a voice clone, we ask it to delete the clone when you delete the avatar, record again or switch to a stock voice.
          </li>
          <li>
            <strong>Stripe:</strong> your email address and your payments.
          </li>
          <li>
            <strong>Resend:</strong> your email address and the emails we send you.
          </li>
          <li>
            <strong>Vercel</strong> and our database provider: hosting, stored files and records.
          </li>
        </ul>
        <p>
          These companies handle the data under their own terms for business customers. Most are in the United States, so your data is processed there and in
          other countries where they operate, which may protect personal data differently from your own.
        </p>
        <p>Beyond these, we disclose personal data only:</p>
        <ul>
          <li>when the law requires it, or to protect someone from serious harm;</li>
          <li>to a company that takes over Aliike, which would have to keep to this policy, and we would tell you first.</li>
        </ul>
        <p>We do not sell personal data, we do not share it for advertising, and we show no ads.</p>
      </Section>

      <Section title="Cookies and what your browser keeps">
        <ul>
          <li>
            <strong>One cookie</strong> keeps you signed in, for up to 60 days. Only our servers can read it.
          </li>
          <li>
            <strong>Your browser&apos;s storage</strong> remembers which avatars you were working on and where to return after signing in.
          </li>
          <li>
            <strong>Stripe</strong> sets its own cookies on its checkout and billing pages.
          </li>
          <li>
            To check a photo and to animate a character&apos;s face, your browser may download face-detection software from Google and jsDelivr, in the creator
            and on avatar pages. It runs on your device and no picture is sent to them, but they see your network address when it is downloaded.
          </li>
        </ul>
        <p>There are no advertising cookies and no third-party analytics.</p>
      </Section>

      <Section title="How long we keep things">
        <ul>
          <li>
            <strong>Your account, your avatars and everything in them:</strong> until you delete them. We do not delete inactive accounts on a schedule, so if
            you stop using Aliike, delete your account.
          </li>
          <li>
            <strong>Sign-in links:</strong> 20 minutes. <strong>Sessions:</strong> 60 days.
          </li>
          <li>
            <strong>Errors:</strong> about 30 days.
          </li>
          <li>
            <strong>The record of steps you reached:</strong> for as long as your account exists. After that the counts are kept, attached to a random
            identifier that leads to nobody.
          </li>
          <li>
            <strong>Reports:</strong> kept after they are handled, as a record of what was reported and what we did.
          </li>
          <li>
            <strong>Payment records:</strong> kept by Stripe for as long as the law requires.
          </li>
        </ul>
      </Section>

      <Section title="Deleting">
        <p>You can delete an avatar or your account from your account page at any time. It takes effect at once:</p>
        <ul>
          <li>
            <strong>Deleting an avatar</strong> removes its photo, portrait, drawings, 3D model, thumbnail, voice recording and everything you wrote for it,
            asks the speech provider to delete its voice clone, and clears the copies of its 3D model held by our content network. Its page stops existing.
          </li>
          <li>
            <strong>Deleting your account</strong> does that for every avatar, ends your plan, signs you out everywhere and removes your email address from our
            records.
          </li>
        </ul>
        <p>What deleting cannot reach:</p>
        <ul>
          <li>Copies the companies above hold from processing, and any backups of our database, which expire on their own schedules.</li>
          <li>A 3D model already downloaded by the browser of someone who visited the avatar&apos;s page.</li>
          <li>Payment records at Stripe.</li>
        </ul>
      </Section>

      <Section title="Security">
        <p>
          Photos, portraits, character drawings and voice recordings are kept in private storage and served only to the account that owns them. Connections are
          encrypted. Sign-in is by a single-use emailed link, and we store no passwords. No system is perfectly secure; if a breach affects your data, we will
          tell you and the authorities as the law requires.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Depending on where you live, you have some or all of these rights:</p>
        <ul>
          <li>to know what data we hold about you and to receive a copy;</li>
          <li>to have it corrected or deleted;</li>
          <li>to withdraw your agreement to the use of your face and voice;</li>
          <li>to object to, or ask us to limit, uses based on our legitimate interests;</li>
          <li>not to be treated worse for using any of these rights.</li>
        </ul>
        <p>
          Deleting is in your account page. For anything else, write to us from your account&apos;s email address and we will answer within 30 days. If you are
          not satisfied with our answer, you can complain to the data protection authority where you live.
        </p>
      </Section>

      <Section title="Age">
        <p>
          Aliike is for people aged 18 and over. We do not knowingly collect data from anyone younger, and an avatar may not be made of anyone younger. If you
          believe one has been, report it and we will remove it.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If we change what we collect, what it is used for or who handles it, we will update this page and its date. For a change that matters, we will email
          you before it takes effect.
        </p>
        <Contact about="about your data" />
      </Section>
    </Legal>
  );
}
