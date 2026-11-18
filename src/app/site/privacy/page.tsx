import type { Metadata } from "next";
import Link from "next/link";
import { PRIVACY_VERSION } from "@/lib/billing/config";
import { COMPANY, CONTACT_EMAIL, LEGAL_ENTITY, SiteFrame, sitePath } from "../frame";

export const metadata: Metadata = { title: "Privacy notice · DinerAI" };

// DinerAI's own privacy notice (for restaurant owners, their staff, and how we handle
// their customers' details on their behalf). Each restaurant also has its own short
// notice on its sign-up page (/r/<slug>/privacy). Keep PRIVACY_VERSION
// (lib/billing/config.ts) in step with any change: sign-ups record which version they saw.
// Every provider listed must match what the code really uses (security review C1).
const PROVIDERS: { name: string; does: string; where: string }[] = [
  { name: "Vercel", does: "hosts the app and website", where: "EU (Dublin); a US company" },
  { name: "Supabase", does: "database, file storage and logins", where: "EU (Ireland)" },
  { name: "Railway", does: "runs our sales forecasts (sales figures only, no names)", where: "US" },
  { name: "Anthropic", does: "the AI that drafts replies, posts, offers and answers", where: "US" },
  { name: "Resend", does: "sends emails", where: "EU" },
  { name: "Twilio", does: "WhatsApp messages between you and DinerAI", where: "US" },
  { name: "Stripe", does: "card payments for subscriptions", where: "EU and US" },
  { name: "Apple, Google and RevenueCat", does: "the app stores and in-app subscriptions", where: "US" },
  { name: "Expo", does: "delivers app notifications", where: "US" },
  { name: "Google", does: "your Google Business Profile, maps and place search, when you connect them", where: "US" },
  { name: "Cloudflare", does: "protects our forms from bots", where: "worldwide" },
];

export default function SitePrivacy() {
  const h2 = "mt-8 text-lg font-bold";
  const p = "mt-2 text-[15px] leading-relaxed text-stone-700";
  const li = "text-[15px] leading-relaxed text-stone-700";
  return (
    <SiteFrame>
      <article className="max-w-2xl pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Privacy notice</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {PRIVACY_VERSION}</p>

        <h2 className={h2}>Who we are</h2>
        <p className={p}>
          {COMPANY} is an AI restaurant manager for independent restaurants: reviews, Google, customer emails, sales, forecasts, rotas and menu profit.{" "}
          {COMPANY} is run by {LEGAL_ENTITY}. If you have a question about your information, email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>

        <h2 className={h2}>Restaurant owners</h2>
        <p className={p}>
          When you sign up we collect your name, email address, mobile number, a password (stored scrambled, never readable) and details about your
          restaurant (such as its address, opening hours, menu, prices, dish costs and photos, some of which we copy from your public Google listing and
          website). We keep the messages you send DinerAI, your approvals and edits, and a log of what was sent, so the service works and you can see and
          undo what happened. If you use the app we keep your device&apos;s notification token. We use this to run the service for you and to contact you
          about it. The legal basis is our contract with you.
        </p>

        <h2 className={h2}>Sales figures and till reports</h2>
        <p className={p}>
          When you send a till report photo, a till export or typed takings, we keep the file in private storage and the figures in your account, to show
          your sales, make forecasts and write your reports. When the AI works out a file&apos;s columns it sees only a few rows, with staff, customer and
          contact columns blanked out.
        </p>

        <h2 className={h2}>Your staff</h2>
        <p className={p}>
          If you add your team, we keep each person&apos;s name, role, hourly rate, usual availability, maximum hours and their shifts in your rotas, and
          the mobile number of anyone you let send till reports. You decide what goes in and you are responsible for it: we process it on your behalf to
          build and share your rotas. We never ask for National Insurance numbers, addresses, bank details or dates of birth. A published rota shows names
          and shifts only, never pay. You can remove a person at any time.
        </p>

        <h2 className={h2}>Your restaurant&apos;s customers</h2>
        <p className={p}>
          When diners sign up at a restaurant using {COMPANY}, or a restaurant imports its own list, the restaurant is responsible for their details and we
          process them on the restaurant&apos;s behalf, following its instructions. Diners confirm their email address before receiving anything, only get
          marketing (including &quot;How was your visit?&quot; emails) if they agree to it, and every email has links to unsubscribe and to delete their
          data. Each restaurant&apos;s sign-up page links to its own privacy notice.
        </p>

        <h2 className={h2}>The AI</h2>
        <p className={p}>
          The AI is given restaurant details and summaries, and, when you ask about a particular customer or review, that one item. It is never given
          customers&apos; email addresses or phone numbers. Under Anthropic&apos;s business terms, what we send is not used to train its models. Nothing the
          AI writes reaches a customer or Google until it passes our checks and you approve it.
        </p>

        <h2 className={h2}>Who helps us</h2>
        <p className={p}>We use these providers to run the service. They only process information to provide their service to us.</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {PROVIDERS.map((x) => (
            <li key={x.name} className={li}>
              <strong>{x.name}</strong>: {x.does} ({x.where})
            </li>
          ))}
        </ul>
        <p className={p}>
          We also look up public data that isn&apos;t about people: weather, postcodes, bank holidays, local events and fixtures. We never sell
          anyone&apos;s information.
        </p>

        <h2 className={h2}>Sending information outside the UK</h2>
        <p className={p}>
          Some providers above are based in, or reach their systems from, the United States. Where information leaves the UK we rely on UK adequacy
          regulations (for the EU, and the UK-US data bridge for companies certified under it), or otherwise on the UK International Data Transfer Agreement
          or the UK Addendum to the EU standard contractual clauses. Email us for a copy of the safeguards that apply.
        </p>

        <h2 className={h2}>Cookies</h2>
        <p className={p}>
          We only use cookies the service needs to work: keeping you logged in and protecting forms from bots. We count website visits without cookies.
          There are no advertising or tracking cookies, so there is nothing to accept. See our{" "}
          <Link href={sitePath("cookies")} className="underline">
            cookie notice
          </Link>
          .
        </p>

        <h2 className={h2}>How long we keep it</h2>
        <p className={p}>
          For as long as you use {COMPANY}. If you leave, we delete your restaurant&apos;s information within 90 days, unless we must keep something longer
          by law. Diners&apos; details are removed straight away if they use &quot;Delete my data&quot;.
        </p>

        <h2 className={h2}>Your rights</h2>
        <p className={p}>
          You can ask to see, correct, download or delete your information, or object to how we use it, by emailing us. Restaurant owners can download their
          customer list at any time. If you&apos;re unhappy with how we&apos;ve handled your information, you can complain to the Information
          Commissioner&apos;s Office (ico.org.uk).
        </p>
      </article>
    </SiteFrame>
  );
}
