import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/app-shell";
import { DraftCard } from "@/components/draft-card";
import { Icon } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { ListCard, Notice, Page, PageHeader, Panel, Pill, Section, WhatsAppTip } from "@/components/ui";
import { waitingItems } from "@/lib/dashboard/data";
import { ownerPage } from "@/lib/dashboard/page-context";
import { ago, plainText } from "@/lib/dashboard/rules";
import { check, KIND_LABELS, type Draft } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// Everything waiting for the owner's Approve / Edit / Skip (the same items as the
// 9am brief), and what was decided lately.
export const metadata: Metadata = { title: "Approvals · DinerAI", robots: { index: false, follow: false } };

export default function ApprovalsPage({ searchParams }: PageProps<"/approvals">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Approvals searchParams={searchParams} />
    </Suspense>
  );
}

const STATUS: Record<string, { label: string; tone: "signal" | "amber" | "neg" | "neutral" }> = {
  sent: { label: "Sent", tone: "signal" },
  approved: { label: "Approved", tone: "signal" },
  queued: { label: "Held: goes out later", tone: "amber" },
  blocked: { label: "Stopped by the safety rules", tone: "neg" },
  skipped: { label: "Skipped", tone: "neutral" },
};

async function Approvals({ searchParams }: Pick<PageProps<"/approvals">, "searchParams">) {
  const { owner, restaurant, choices, one, now } = await ownerPage("/approvals", searchParams);
  if (!restaurant) return <Page narrow>No restaurant found for {owner.email}.</Page>;
  const r = restaurant.id;
  const [items, recent] = await Promise.all([
    waitingItems(r),
    getSupabase()
      .from("drafts")
      .select("id, kind, content, status, audience, updated_at")
      .eq("restaurant_id", r)
      .in("status", Object.keys(STATUS))
      .order("updated_at", { ascending: false })
      .limit(12)
      .returns<Pick<Draft, "id" | "kind" | "content" | "status" | "audience" | "updated_at">[]>()
      .then(check),
  ]);

  return (
    <Page narrow>
      <RestaurantSwitcher choices={choices} current={r} path="/approvals" />
      <PageHeader eyebrow="Approvals" title="Waiting for you" sub={items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} to decide` : "Nothing to decide right now"} />
      <div className="space-y-4">
        {one("done") && <Notice>{one("done")}</Notice>}
        {one("oops") && <Notice tone="neg">{one("oops")}</Notice>}
        {items.length ? (
          items.map((w) => <DraftCard key={w.draft.id} item={w} restaurantId={r} back="/approvals" now={now} />)
        ) : (
          <Panel className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#c8f03c]/12 text-[#c8f03c]">
              <Icon name="check" className="h-5 w-5" strokeWidth={2.4} />
            </div>
            <div className="text-[15px] text-[#edefe8]">You&apos;re all caught up.</div>
          </Panel>
        )}
        <WhatsAppTip>
          Nothing reaches a customer or Google until you approve it, and every approval still passes the safety checks (sending hours, your discount limit,
          consent). On WhatsApp, reply <span className="text-[#edefe8]">APPROVE ALL</span> to approve your whole brief.
        </WhatsAppTip>
      </div>

      {(recent ?? []).length > 0 && (
        <div className="mt-8">
          <Section title="Recently decided">
            <ListCard>
              {(recent ?? []).map((d) => {
                const st = STATUS[d.status] ?? STATUS.skipped;
                return (
                  <div key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <div className="text-[14px] text-[#edefe8]">
                        {KIND_LABELS[d.kind]}
                        {d.audience ? <span className="text-[#a3a99d]"> · {d.audience}</span> : null}
                      </div>
                      <div className="truncate text-[13px] text-[#a3a99d]">{plainText(d.content)}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={st.tone}>{st.label}</Pill>
                      <span className="font-mono text-[11px] text-[#6e7468]">{ago(d.updated_at, now)}</span>
                    </div>
                  </div>
                );
              })}
            </ListCard>
          </Section>
        </div>
      )}
    </Page>
  );
}
