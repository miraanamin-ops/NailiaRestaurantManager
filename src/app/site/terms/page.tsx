import type { Metadata } from "next";
import { COMPANY, CONTACT_EMAIL, LEGAL_ENTITY, SiteFrame } from "../frame";

export const metadata: Metadata = { title: "Terms · DinerAI" };

const UPDATED = "13 November 2026";

// Plain-English terms of use for restaurant owners.
export default function SiteTerms() {
  const h2 = "mt-8 text-lg font-bold";
  const p = "mt-2 text-[15px] leading-relaxed text-stone-700";
  return (
    <SiteFrame>
      <article className="max-w-2xl pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Terms of use</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {UPDATED}</p>

        <h2 className={h2}>The service</h2>
        <p className={p}>
          {COMPANY} drafts marketing for your restaurant (review replies, Google posts and customer emails) and sends you each draft in the DinerAI app. Nothing
          is sent until you approve it. {COMPANY} is provided by {LEGAL_ENTITY} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). {COMPANY} is in early access, so features may change and we may occasionally need to pause the service.
        </p>

        <h2 className={h2}>Your responsibilities</h2>
        <p className={p}>
          You&apos;re responsible for what you approve, including prices, offers and claims, and for honouring offers sent to your customers. Please
          check drafts before approving them. Only add customers who have signed up through your {COMPANY} sign-up page or otherwise agreed to hear from
          you, and don&apos;t use the service to send anything unlawful, misleading or offensive.
        </p>
        <p className={p}>
          If you import a customer list, you&apos;re responsible for having a lawful basis to contact everyone on it: that they opted in to hear
          from you, or that they&apos;re past customers who bought from you and were given a chance to opt out when their details were taken. When you
          import, you confirm which applies, and we record your answer, the time and the file. {COMPANY} sends each imported customer one welcome
          email you approve, with a way to unsubscribe, before anything else, and won&apos;t import a list if you don&apos;t know how its customers agreed.
        </p>

        <h2 className={h2}>Your data</h2>
        <p className={p}>
          Your restaurant&apos;s information and customer list belong to you. You can download your customer list at any time. We handle personal
          information as described in our privacy notice, and process your customers&apos; details only on your behalf.
        </p>

        <h2 className={h2}>Google and the app stores</h2>
        <p className={p}>
          When {COMPANY} works with your Google Business Profile, or you use our app from the App Store or Google Play, their own terms also apply. We follow their rules, for example by asking
          every customer for a Google review in the same way, never only the happy ones.
        </p>

        <h2 className={h2}>Ending</h2>
        <p className={p}>
          You can stop using {COMPANY} at any time by emailing us. We may end or suspend an account that breaks these terms. Either way, you can ask for
          a copy of your customer list first.
        </p>

        <h2 className={h2}>Liability</h2>
        <p className={p}>
          We work hard to make {COMPANY} reliable and accurate, but we can&apos;t promise it will always be available or error-free. To the extent the
          law allows, we aren&apos;t liable for indirect losses such as lost profits. Nothing in these terms limits liability that can&apos;t be limited
          by law.
        </p>

        <h2 className={h2}>Contact</h2>
        <p className={p}>
          Questions about these terms:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          . These terms are governed by the law of England and Wales.
        </p>
      </article>
    </SiteFrame>
  );
}
