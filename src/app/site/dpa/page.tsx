import type { Metadata } from "next";
import { DPA_VERSION } from "@/lib/billing/config";
import { COMPANY, CONTACT_EMAIL, SiteFrame } from "../frame";

export const metadata: Metadata = { title: "Data processing agreement · DinerAI" };

// The data processing agreement owners accept at sign-up (UK GDPR article 28):
// DinerAI handles their customers' details on their behalf. DRAFT: to be checked
// by someone qualified before real restaurants sign up (docs/before-launch.md).
export default function SiteDpa() {
  const h2 = "mt-8 text-lg font-bold";
  const p = "mt-2 text-[15px] leading-relaxed text-stone-700";
  const li = "text-[15px] leading-relaxed text-stone-700";
  return (
    <SiteFrame>
      <article className="max-w-2xl pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Data processing agreement</h1>
        <p className="mt-2 text-sm text-stone-500">Version {DPA_VERSION} (draft)</p>

        <p className={p}>
          This agreement is between you (the restaurant, the &ldquo;controller&rdquo;) and {COMPANY} (the &ldquo;processor&rdquo;). It covers the
          personal information about your customers and staff that {COMPANY} handles for you, and forms part of our Terms of use.
        </p>

        <h2 className={h2}>What we process, and why</h2>
        <p className={p}>
          Your customers&apos; names, email addresses, birthdays (if they give one), marketing consent records, rewards and feedback; your staff
          members&apos; names, roles, pay rates and availability if you add them. We use them only to run {COMPANY} for you: sign-ups, emails you
          approve, rewards, feedback, reports and rotas.
        </p>

        <h2 className={h2}>Our promises</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li className={li}>We act only on your instructions, which are these terms and what you approve in {COMPANY}.</li>
          <li className={li}>Everyone at {COMPANY} who can see the data is bound to keep it confidential.</li>
          <li className={li}>We keep it secure: encrypted connections, restricted access, and each restaurant&apos;s data kept apart.</li>
          <li className={li}>
            We use these sub-processors, each under its own data protection terms: Supabase (database), Vercel (hosting), Anthropic (AI drafting; no
            customer lists or contact details are sent to it), Twilio (WhatsApp), Resend (email), Cloudflare (spam protection) and Google (your
            Business Profile, if you connect it). We&apos;ll tell you before adding another.
          </li>
          <li className={li}>We help you answer customers who ask to see or delete their data (every email already has a &ldquo;Delete my data&rdquo; link).</li>
          <li className={li}>We tell you without undue delay if a breach affects your data.</li>
          <li className={li}>When you leave, we delete your customers&apos; personal details, or give you a copy first if you ask.</li>
        </ul>

        <h2 className={h2}>Your side</h2>
        <p className={p}>
          You make sure you&apos;re allowed to give us the information, for example that customers you import agreed to hear from you.
        </p>

        <h2 className={h2}>Questions</h2>
        <p className={p}>
          Email{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </article>
    </SiteFrame>
  );
}
