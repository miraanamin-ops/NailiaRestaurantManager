import type { Metadata } from "next";
import { CONTACT_EMAIL, SiteFrame, startUrl } from "./frame";

export const metadata: Metadata = {
  title: "DinerAI: your restaurant's marketing, handled on WhatsApp",
  description:
    "DinerAI is an AI marketing assistant for independent restaurants. It replies to Google reviews, writes posts and sends offers to your customers. You approve everything on WhatsApp with one tap.",
};

const FEATURES = [
  { icon: "⭐", title: "Google reviews answered", text: "A thoughtful reply to every review, in your voice. Bad reviews reach you straight away." },
  { icon: "📍", title: "Your Google profile kept fresh", text: "Two posts a week from your menu and photos, so you show up when people search nearby." },
  { icon: "📧", title: "Customers who come back", text: "A QR code at the till signs diners up. Welcome rewards, birthday treats and offers for quiet nights follow." },
  { icon: "☀️", title: "One message each morning", text: "Everything waiting for you in a single brief. Approve, edit or skip, and get on with service." },
];

const PROMISES = [
  "Nothing goes out without your approval.",
  "Customers only hear from you if they asked to, and can unsubscribe or delete their data in one tap.",
  "Your customer list is yours: download it any time.",
];

// dinerai.co.uk: what DinerAI does for restaurant owners, in one page.
export default function SiteHome() {
  return (
    <SiteFrame>
      <section className="pb-10 pt-6 sm:pt-12">
        <p className="text-sm font-semibold uppercase tracking-wider text-[#c2410c]">For independent restaurants</p>
        <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">Your restaurant&apos;s marketing, handled on WhatsApp.</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-700">
          DinerAI does the work: replies to reviews, posts on Google and offers to your regulars. You stay in charge. Every message arrives finished, and you
          approve it with one tap.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a href={startUrl()} className="rounded-full bg-[#c2410c] px-7 py-4 text-center text-base font-semibold text-white shadow-sm hover:bg-[#9a3412]">
            Get set up
          </a>
          <a href={`mailto:${CONTACT_EMAIL}`} className="rounded-full border-2 border-stone-900 px-7 py-[14px] text-center text-base font-semibold hover:bg-white">
            Talk to us
          </a>
        </div>
      </section>

      <section aria-labelledby="what" className="py-8">
        <h2 id="what" className="text-2xl font-bold tracking-tight">What it does for you</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-stone-200/70">
              <p className="text-2xl" aria-hidden>
                {f.icon}
              </p>
              <h3 className="mt-2 font-semibold">{f.title}</h3>
              <p className="mt-1 text-[15px] leading-relaxed text-stone-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="py-8">
        <h2 id="how" className="text-2xl font-bold tracking-tight">How it works</h2>
        <ol className="mt-5 space-y-4">
          {[
            ["Set up in minutes", "We find you on Google, read your menu from a photo and learn how you like to sound."],
            ["We draft, you decide", "Drafts arrive on WhatsApp with Approve, Edit and Skip buttons. Every one is checked for prices, facts and tone first."],
            ["See what's working", "A short report every Monday: reviews, new sign-ups, offers redeemed and what to try next week."],
          ].map(([title, text], i) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-900 text-sm font-bold text-white">{i + 1}</span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-[15px] leading-relaxed text-stone-600">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="promise" className="py-8">
        <div className="rounded-2xl bg-stone-900 p-6 text-stone-100">
          <h2 id="promise" className="text-xl font-bold">Our promises</h2>
          <ul className="mt-3 space-y-2 text-[15px] leading-relaxed">
            {PROMISES.map((p) => (
              <li key={p} className="flex gap-2">
                <span aria-hidden className="text-[#fb923c]">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="py-8 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Questions?</h2>
        <p className="mt-2 text-stone-600">
          Email us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-stone-900 underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>
    </SiteFrame>
  );
}
