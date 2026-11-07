import { Suspense } from "react";
import type { Metadata } from "next";
import { PageSkeleton } from "@/components/app-shell";
import { logOut } from "@/app/login/actions";
import { Icon } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { Eyebrow, ListCard, Page, PageHeader, Row, withR } from "@/components/ui";
import { ownerPage } from "@/lib/dashboard/page-context";
import { check } from "@/lib/drafts";
import { getSupabase } from "@/lib/supabase";

// The phone's "More" tab: every other owner page.
export const metadata: Metadata = { title: "More · DinerAI", robots: { index: false, follow: false } };

export default function MorePage({ searchParams }: PageProps<"/more">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <More searchParams={searchParams} />
    </Suspense>
  );
}

async function More({ searchParams }: Pick<PageProps<"/more">, "searchParams">) {
  const { owner, restaurant, choices } = await ownerPage("/more", searchParams);
  if (!restaurant) return <Page narrow>No restaurant found for {owner.email}.</Page>;
  const r = restaurant.id;
  const report = check(
    await getSupabase()
      .from("reports")
      .select("token, created_at")
      .eq("restaurant_id", r)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ token: string; created_at: string }>(),
  );
  return (
    <Page narrow>
      <RestaurantSwitcher choices={choices} current={r} path="/more" />
      <PageHeader eyebrow="More" title={restaurant.name} sub={owner.email} />
      <div className="space-y-6">
        <div className="space-y-2">
          <Eyebrow className="px-1">Your restaurant</Eyebrow>
          <ListCard>
            <Row href={withR("/reviews", r)} icon="star" label="Reviews" />
            <Row href={withR("/staff", r)} icon="team" label="Team and rota" />
            {report && (
              <Row
                href={`/report/${report.token}`}
                icon="report"
                label="Weekly report"
                value={new Date(report.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" })}
              />
            )}
            <Row href={withR("/log", r)} icon="activity" label="Activity" sub="Everything that happened, with Undo" />
          </ListCard>
        </div>
        <div className="space-y-2">
          <Eyebrow className="px-1">Account</Eyebrow>
          <ListCard>
            <Row href={withR("/settings", r)} icon="settings" label="Settings" />
            <Row href="/account/password" icon="shield" label="Change password" />
            {owner.isBuilder && <Row href={withR("/builder", r)} icon="shield" label="Test data (builder)" />}
            <form action={logOut}>
              <button className="flex min-h-[54px] w-full items-center gap-3 px-4 text-left text-[15px] font-medium text-[#ff8a6e] transition hover:bg-[#1e221b]">
                <Icon name="logout" className="h-5 w-5" /> Log out
              </button>
            </form>
          </ListCard>
        </div>
      </div>
    </Page>
  );
}
