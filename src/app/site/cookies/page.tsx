import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY, CONTACT_EMAIL, SiteFrame, sitePath } from "../frame";

export const metadata: Metadata = { title: "Cookie notice · DinerAI" };

const UPDATED = "18 November 2026";

// The cookies DinerAI sets (security review W4). Only strictly necessary ones,
// so no consent banner is needed under PECR. Keep this list in step with the code:
// Supabase's login cookies (lib/auth.ts) and Cloudflare Turnstile on forms.
// Visitor counts use Vercel Web Analytics, which sets no cookies.
const COOKIES: { name: string; why: string; lasts: string }[] = [
  { name: "sb-…-auth-token", why: "Keeps you logged in to your DinerAI account (owner pages only).", lasts: "Until you log out, up to a few weeks" },
  { name: "cf_clearance, __cf_bm (Cloudflare)", why: "Set by Cloudflare's bot check on sign-up forms, to tell people from bots.", lasts: "Up to 30 minutes, or a day" },
];

export default function SiteCookies() {
  const h2 = "mt-8 text-lg font-bold";
  const p = "mt-2 text-[15px] leading-relaxed text-stone-700";
  return (
    <SiteFrame>
      <article className="max-w-2xl pt-4">
        <h1 className="text-3xl font-bold tracking-tight">Cookie notice</h1>
        <p className="mt-2 text-sm text-stone-500">Last updated {UPDATED}</p>
        <p className={p}>
          {COMPANY} only uses cookies that are strictly necessary for the service to work. There are no advertising, tracking or social media cookies,
          so there is nothing to accept or turn off. We count visits to this website without cookies, and without recording who you are.
        </p>

        <h2 className={h2}>The cookies we use</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[14px] text-stone-700">
            <thead>
              <tr className="border-b border-stone-300">
                <th className="py-2 pr-4 font-semibold">Cookie</th>
                <th className="py-2 pr-4 font-semibold">What it does</th>
                <th className="py-2 font-semibold">How long</th>
              </tr>
            </thead>
            <tbody>
              {COOKIES.map((c) => (
                <tr key={c.name} className="border-b border-stone-200 align-top">
                  <td className="py-2 pr-4 font-mono text-[13px]">{c.name}</td>
                  <td className="py-2 pr-4">{c.why}</td>
                  <td className="py-2">{c.lasts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h2 className={h2}>Controlling cookies</h2>
        <p className={p}>
          You can delete or block cookies in your browser&apos;s settings. If you block these ones, you won&apos;t be able to log in or send a sign-up form.
        </p>

        <h2 className={h2}>More</h2>
        <p className={p}>
          How we use personal information is in our{" "}
          <Link href={sitePath("privacy")} className="underline">
            privacy notice
          </Link>
          . Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </article>
    </SiteFrame>
  );
}
