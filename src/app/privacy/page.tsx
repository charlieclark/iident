import type { Metadata } from "next";
import { Contact, Legal, Section } from "@/components/Legal";
import { RETENTION } from "@/lib/retention";
import { SITE } from "@/lib/site";

export const metadata: Metadata = { title: "Privacy", description: "What Aliike collects, why, who else handles it, and how to delete it." };

// A plain-language draft that follows what the code does (see src/lib/server).
// Have it reviewed by a lawyer before launch: face data is treated
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
          To make your avatar we need a photo of your face, which is about as personal as data gets. This page says what {SITE.legalName} (&quot;we&quot;)
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
            <strong>What you choose and write for your avatar:</strong> its look, voice, name, personality, what it knows, its background, and the links, pictures and
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
            <strong>Your network address,</strong> briefly. Our hosting provider logs each request (address, browser type, page) and keeps the log for about a day. To limit
            abuse we also count requests per address, keeping only a scrambled form of the address, which is cleared once it has gone unused for a while.
          </li>
          <li>
            <strong>Reports.</strong> If you report an avatar we keep what you wrote and, if you give it, your email address.
          </li>
        </ul>
      </Section>

      <Section title="Your face">
        <p>
          A photo of your face, and the portrait and character made from it, may count as biometric or specially protected data where you live. For these:
        </p>
        <ul>
          <li>
            <strong>We ask first.</strong> You tick a box agreeing before a photo is used. If the face belongs to someone else, you confirm that they agreed.
          </li>
          <li>
            <strong>One purpose.</strong> We use them to make your avatar and show it. We do not use them to identify or recognise people, we do not sell
            them, we do not use them for advertising, and we do not use them to train AI models.
          </li>
          <li>
            <strong>Who sees them.</strong> Only you, and the companies listed below that do the drawing and building. The published avatar shows the 3D
            character; your photo is never shown to visitors.
          </li>
          <li>
            <strong>Not your voice.</strong> We never record or copy your voice. Your avatar speaks in a ready-made voice that you pick.
          </li>
          <li>
            <strong>Kept only while you use them.</strong> We destroy them when you delete the avatar or your account, or when the account has gone unused
            for {RETENTION.inactiveMonths} months, whichever comes first. &quot;How long we keep things&quot; and &quot;Deleting&quot; below are our
            retention schedule. Deleting is how you withdraw your agreement.
          </li>
          <li>
            <strong>Other companies&apos; rules.</strong> The companies that draw and build for us each work under their own terms, set out under
            &quot;Who else handles your data&quot;, including whether they may use what they process to improve their own services.
          </li>
          <li>
            <strong>If it is your face and you did not agree,</strong> use the Report link on the avatar&apos;s page or write to us, and we will take
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
            <strong>With your agreement:</strong> processing the face in your photo, as described above.
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
            The avatar&apos;s owner does not see what you said. We count how many replies each avatar gives, not what they contain. The companies below
            keep what they receive for a limited time, as listed there.
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
        <p>We use other companies to run parts of the service. Each receives only what its part needs, and handles it under its own terms:</p>
        <ul>
          <li>
            <strong>
              <a href="https://fal.ai/privacy">fal.ai</a>
            </strong>{" "}
            draws your character and builds its 3D model from your photo and the pictures made from it, and turns visitors&apos; voice messages into
            text. Some of the models are run by their makers, currently OpenAI, Google, Black Forest Labs and Meshy, who then receive the pictures too.
            We have fal delete its copies of your photo, and of everything made from it, after 24 hours at most, and of a voice message after one hour.
            We delete them there at once when you delete your avatar. fal keeps no record of a drawing or a transcription; of a 3D build it keeps the request, which holds settings and
            links but no pictures, for up to 90 days.
          </li>
          <li>
            <strong>
              <a href="https://www.anthropic.com/legal/privacy">Anthropic</a>
            </strong>{" "}
            writes the avatar&apos;s replies from what the avatar is told about itself and the conversation so far. Its terms bar it from training its models
            on this, and it deletes it within 30 days unless it is flagged for a breach of its rules.
          </li>
          <li>
            <strong>
              <a href="https://elevenlabs.io/privacy-policy">ElevenLabs</a>
            </strong>{" "}
            produces the speech. It receives only the text to be spoken, which is what an avatar says, never a recording of anyone. It keeps a history of
            that speech until we clear it, and its standard terms let it use what it processes to improve its services unless the customer has refused.
          </li>
          <li>
            <strong>
              <a href="https://stripe.com/privacy">Stripe</a>
            </strong>{" "}
            takes payments. It receives your email address and collects your card and billing details itself.
          </li>
          <li>
            <strong>
              <a href="https://resend.com/legal/privacy-policy">Resend</a>
            </strong>{" "}
            sends our emails. It receives your email address and the emails, and keeps a copy of each for 30 days.
          </li>
          <li>
            <strong>
              <a href="https://vercel.com/legal/privacy-policy">Vercel</a>
            </strong>{" "}
            hosts the site and stores the files (photos, pictures, 3D models) in private storage that runs on Amazon Web Services.
          </li>
          <li>
            <strong>
              <a href="https://neon.com/privacy-policy">Neon</a>
            </strong>{" "}
            (a Databricks company) runs the database, which holds accounts and everything about an avatar that is not a file.
          </li>
        </ul>
        <p>
          Most of these companies are in the United States, so your data is processed there and in other countries where they operate, which may protect
          personal data differently from your own.
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
            <strong>Your account, your avatars and everything in them:</strong> until you delete them, or until the account goes unused.
          </li>
          <li>
            <strong>Unused accounts:</strong> if an account has no paid plan and nobody has signed in to it for {RETENTION.inactiveMonths} months, we email
            its owner, and {RETENTION.warningDays} days later delete the account and everything in it. Signing in at any point before then keeps it.
          </li>
          <li>
            <strong>Sign-in links:</strong> 20 minutes. <strong>Sessions:</strong> 60 days.
          </li>
          <li>
            <strong>Errors:</strong> about 30 days. <strong>Hosting logs:</strong> about a day.
          </li>
          <li>
            <strong>Copies at the companies above:</strong> photos and pictures at fal.ai 24 hours, voice messages one hour, conversations at Anthropic up to 30 days,
            emails at Resend 30 days. Speech history at ElevenLabs stays until we clear it.
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
            <strong>Deleting an avatar</strong> permanently removes its photo, portrait, drawings, 3D model, thumbnail and everything you wrote for it. It
            also deletes the copies fal.ai holds, and clears the copies of its 3D model held by our content network. Its page stops existing.
          </li>
          <li>
            <strong>Deleting your account</strong> does that for every avatar, ends your plan, signs you out everywhere and removes your email address from our
            records.
          </li>
        </ul>
        <p>What deleting cannot reach straight away:</p>
        <ul>
          <li>Backups of our database, which Neon keeps for up to 30 days. They hold records such as your email address and what you wrote, not files.</li>
          <li>The copies listed above that other companies keep for a fixed time, such as emails and conversations.</li>
          <li>A 3D model already downloaded by the browser of someone who visited the avatar&apos;s page.</li>
          <li>Payment records at Stripe.</li>
        </ul>
      </Section>

      <Section title="Security">
        <p>
          Photos, portraits and character drawings are kept in private storage and served only to the account that owns them. Connections are
          encrypted. Sign-in is by a single-use emailed link, and we store no passwords. No system is perfectly secure; if a breach affects your data, we will
          tell you and the authorities as the law requires.
        </p>
      </Section>

      <Section title="Your rights">
        <p>Depending on where you live, you have some or all of these rights:</p>
        <ul>
          <li>to know what data we hold about you and to receive a copy;</li>
          <li>to have it corrected or deleted;</li>
          <li>to withdraw your agreement to the use of your face;</li>
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
