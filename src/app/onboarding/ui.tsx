import Link from "next/link";
import QRCode from "qrcode";
import { isSandbox, ourWhatsAppNumber, sandboxJoinPhrase } from "@/lib/onboarding/channel";
import { linkMessage, showNumber, STEP_LABELS, STEPS, whatsAppLink, type StepId } from "@/lib/onboarding/steps";

// Shared pieces of the onboarding pages: mobile first, one thing per screen, big buttons.

export const button = "block w-full rounded-xl bg-stone-900 px-4 py-4 text-center text-base font-semibold text-white disabled:opacity-50";
export const secondary = "block w-full rounded-xl bg-white px-4 py-4 text-center text-base font-semibold text-stone-900 ring-1 ring-stone-300";
export const input = "w-full rounded-xl border border-stone-300 px-4 py-3 text-base";

export function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-stone-100 px-4 py-6 text-stone-900">
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}

export function Progress({ step, done, total }: { step: StepId | null; done: number; total: number }) {
  const n = step ? STEPS.indexOf(step) + 1 : total;
  return (
    <div className="mb-5">
      <div className="flex justify-between text-xs font-medium text-stone-500">
        <span>
          Step {n} of {total}
          {step ? `: ${STEP_LABELS[step]}` : ""}
        </span>
        <span>{Math.round((done / total) * 100)}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${Math.max(4, (done / total) * 100)}%` }} />
      </div>
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-2xl bg-white p-5 shadow-sm">{children}</div>;
}

export function SwitchToWhatsApp({ restaurantId }: { restaurantId: string }) {
  return (
    <p className="mt-6 text-center text-sm">
      <Link href={`/onboarding/whatsapp?r=${restaurantId}`} className="font-medium text-emerald-700 underline">
        Finish on WhatsApp instead
      </Link>
    </p>
  );
}

// Linking the owner's WhatsApp: (in sandbox mode) join the sandbox, then send the code.
// Works on a phone (tap the buttons) or a computer (scan the QR codes).
export async function LinkWhatsApp({ code, expected }: { code: string; expected: string | null }) {
  const ours = ourWhatsAppNumber();
  const join = sandboxJoinPhrase();
  const codeLink = whatsAppLink(ours, linkMessage(code));
  const qr = await QRCode.toString(codeLink, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return (
    <div className="space-y-4">
      {isSandbox() && (
        <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">First: join our test WhatsApp</p>
          <p className="mt-1">
            Naila is in testing, using Twilio&apos;s shared test number. WhatsApp only lets it message you once you&apos;ve joined, by sending{" "}
            {join ? <b>{join}</b> : "the join phrase your Naila contact gave you"} to <b>{showNumber(ours)}</b>. You only do this once.
          </p>
          {join && (
            <a href={whatsAppLink(ours, join)} className={`${secondary} mt-3`}>
              1. Send &ldquo;{join}&rdquo;
            </a>
          )}
        </div>
      )}
      <a href={codeLink} className={button}>
        {isSandbox() && join ? "2. " : ""}Open WhatsApp and send my code
      </a>
      <p className="text-center text-sm text-stone-600">
        It sends <b>{linkMessage(code)}</b>
        {expected ? ` from ${showNumber(expected)}` : ""}. On a computer? Scan this with your phone:
      </p>
      <div className="mx-auto w-44" dangerouslySetInnerHTML={{ __html: qr }} />
    </div>
  );
}
