import type { Metadata } from "next";
import { COMPANY, CONTACT_EMAIL, SiteFrame } from "../frame";

export const metadata: Metadata = { title: "Privacy notice · DinerAI" };

const UPDATED = "10 October 2026";

// DinerAI's own privacy notice (for restaurant owners, and how we handle their
// customers' details on their behalf). Each restaurant also has its own short
// notice on its sign-up page (/r/<slug>/privacy).
export default function SitePrivacy() {
  const h2 = "mt-8 text-lg font-bold";
  const p = "mt-2 text-[15px] leading-relaxed text-stone-700";
  return (
    <SiteFrame>
      <article className="max-w-2xl pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Privacy notice</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {UPDATED}</p>

        <h2 className={h2}>Who we are</h2>
        <p className={p}>
          {COMPANY} provides an AI marketing assistant for restaurants. If you have a question about your information, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <h2 className={h2}>Restaurant owners</h2>
        <p className={p}>
          When you sign up we collect your name, email address, WhatsApp number and details about your restaurant (such as its address, opening hours,
          menu and photos, some of which we copy from your public Google listing and website). We keep the messages you send the assistant, your
          approvals and edits, and a log of what was sent, so the service works and you can see and undo what happened. We use this to run the service
          for you, and to contact you about it. The legal basis is our contract with you.
        </p>

        <h2 className={h2}>Your restaurant&apos;s customers</h2>
        <p className={p}>
          When diners sign up at a restaurant using {COMPANY}, the restaurant is responsible for their details and we process them on the restaurant&apos;s
          behalf, following its instructions. Diners confirm their email address before receiving anything, only get marketing if they agree to it, and
          every email has links to unsubscribe and to delete their data. Each restaurant&apos;s sign-up page links to its own privacy notice.
        </p>

        <h2 className={h2}>Who helps us</h2>
        <p className={p}>
          We use trusted providers to run the service: Vercel (hosting), Supabase (database), Resend (email), Twilio and Meta (WhatsApp), Anthropic
          (the AI that drafts messages), Google (business listings) and Cloudflare (protecting forms from bots). They only process information to provide
          their service to us. The AI is given restaurant details and summaries, never customer lists or contact details. We never sell anyone&apos;s
          information.
        </p>

        <h2 className={h2}>How long we keep it</h2>
        <p className={p}>
          For as long as you use {COMPANY}. If you leave, we delete your restaurant&apos;s information within 90 days, unless we must keep something
          longer by law. Diners&apos; details are removed straight away if they use &quot;Delete my data&quot;.
        </p>

        <h2 className={h2}>Your rights</h2>
        <p className={p}>
          You can ask to see, correct, download or delete your information by emailing us. Restaurant owners can download their customer list at any
          time. If you&apos;re unhappy with how we&apos;ve handled your information, you can complain to the Information Commissioner&apos;s Office
          (ico.org.uk).
        </p>
      </article>
    </SiteFrame>
  );
}
