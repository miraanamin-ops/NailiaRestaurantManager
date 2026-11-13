import { approveFromWeb, skipFromWeb } from "@/app/approvals/actions";
import { ago, plainText } from "@/lib/dashboard/rules";
import type { WaitingItem } from "@/lib/dashboard/data";
import { KIND_LABELS } from "@/lib/drafts";
import { appChatLink } from "@/lib/app-link";
import { Icon } from "./icons";
import { btnGhost, btnPrimary, btnSecondary, Eyebrow, Panel, Pill, Stars } from "./ui";

// One thing waiting for the owner: what it is, the review it answers (if any), the
// draft, and Approve / Edit / Skip. Approve and Skip happen here (every safety rule
// still runs before anything goes out); Edit, and questions, open WhatsApp.

const SOURCE: Partial<Record<string, string>> = {
  review_reply: "Google review",
  google_post: "Google post",
  email_campaign: "Email",
  hours_update: "Google",
  menu_update: "Google",
  rota: "Rota",
};

export function DraftCard({ item, restaurantId, back, now }: { item: WaitingItem; restaurantId: string; back: string; now: Date }) {
  const { draft: d, review } = item;
  const label = item.urgent ? "Needs attention" : d.kind === "email_campaign" && item.campaignName ? item.campaignName : KIND_LABELS[d.kind];
  const n = d.brief_number;
  const waLink = (text: string) => appChatLink(text);
  const flags = d.check_notes?.flags ?? [];
  return (
    <Panel edge={item.urgent ? "ember" : undefined} className="space-y-3">
      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow tone={item.urgent ? "ember" : "fog"}>{label}</Eyebrow>
            <span className="font-mono text-[11px] text-[#6e7468]">{ago(d.created_at, now)}</span>
          </div>
          {review ? (
            <div className="flex items-center gap-2">
              <Stars rating={review.rating} />
              <span className="text-[15px] font-medium text-[#edefe8]">{review.author_name}</span>
            </div>
          ) : d.audience ? (
            <div className="text-[15px] font-medium text-[#edefe8]">{d.audience}</div>
          ) : null}
        </div>
        {SOURCE[d.kind] && <Pill>{SOURCE[d.kind]}</Pill>}
      </div>

      {review?.text && <p className="pl-1 text-[14px] italic leading-relaxed text-[#a3a99d]">“{review.text.length > 260 ? `${review.text.slice(0, 260)}…` : review.text}”</p>}

      {item.previewUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt="How the email looks" className="max-h-72 w-full rounded-xl object-cover object-top ring-1 ring-[#2c3127]" />
      )}

      <div className="space-y-1.5 rounded-xl bg-[#1e221b] p-3">
        <Eyebrow tone="signal">{d.kind === "review_reply" ? "Drafted reply" : "Draft"}</Eyebrow>
        <p className="whitespace-pre-line text-[14px] leading-relaxed text-[#edefe8]">{plainText(d.content)}</p>
      </div>

      {flags.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl bg-[#ffb23d]/10 px-3 py-2 text-[13px] text-[#ffe2a8]">
          <Icon name="shield" className="mt-0.5 h-4 w-4 text-[#ffb23d]" />
          <span>{flags.join(" ")}</span>
        </div>
      )}

      {item.onWeb ? (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <form action={approveFromWeb} className="flex-1">
            <input type="hidden" name="r" value={restaurantId} />
            <input type="hidden" name="draft" value={d.id} />
            <input type="hidden" name="back" value={back} />
            <button className={`${btnPrimary} w-full`}>
              <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />
              Approve
            </button>
          </form>
          <a href={waLink(n ? `EDIT ${n}` : "")} target="_blank" rel="noreferrer" className={btnSecondary}>
            Edit
          </a>
          <details className="group open:w-full">
            <summary className={`${btnGhost} cursor-pointer list-none group-open:hidden`}>Skip</summary>
            <form action={skipFromWeb} className="flex w-full flex-col gap-2 sm:flex-row">
              <input type="hidden" name="r" value={restaurantId} />
              <input type="hidden" name="draft" value={d.id} />
              <input type="hidden" name="back" value={back} />
              <input
                name="reason"
                placeholder="Why not? (optional, helps me learn)"
                className="h-10 min-w-0 flex-1 rounded-xl bg-[#121410] px-3 text-[14px] text-[#edefe8] ring-1 ring-[#2c3127] placeholder:text-[#6e7468] focus:outline-none focus:ring-[#c8f03c]"
              />
              <button className={btnSecondary}>Skip it</button>
            </form>
          </details>
        </div>
      ) : (
        <a href={waLink(n ? `${n}` : "")} target="_blank" rel="noreferrer" className={`${btnSecondary} w-full`}>
          <Icon name="chat" className="h-4 w-4 text-[#c8f03c]" />
          Answer in the app
        </a>
      )}
    </Panel>
  );
}
