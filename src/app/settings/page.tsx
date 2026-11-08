import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import { connection } from "next/server";
import Link from "next/link";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { Eyebrow, ListCard, Notice, Page, PageHeader, Panel, Pill, Row } from "@/components/ui";
import { pickRestaurantId, requireOwner, restaurantChoices } from "@/lib/auth";
import { initials } from "@/lib/dashboard/rules";
import { DAYS } from "@/lib/onboarding/profile-data";
import { getRestaurant } from "@/lib/onboarding/store";
import { menuWithIds } from "@/lib/ops/menu";
import { AllergenEditor, MenuEditor } from "@/app/onboarding/(wizard)/setup/editors";
import { button, Card, input } from "../onboarding/ui";
import { OFFER_TYPE_LABELS, OFFER_TYPES } from "@/lib/offers";
import { getSupabase } from "@/lib/supabase";
import { dryRunContext, googleDryRun } from "@/lib/gate-rules";
import { saveBenchmark, saveBrand, saveDetails, saveSettingsAllergens, saveSettingsMenu, uploadSheet } from "./actions";
import { safeTemplateUrls, TEMPLATE_KINDS, TEMPLATE_LABELS, TEMPLATE_LINK_DAYS } from "@/lib/templates/links";
import { BillingBanner, BillingCard, ReferralCard } from "./billing-card";
import { BuilderCard, CalendarCard, CostCard, HistoryCard, OwnerCard, VoiceCard } from "./profile-cards";
import { OutsideDataCard, TeamsCard } from "./outside-cards";

export const metadata: Metadata = { title: "Settings · DinerAI", robots: { index: false, follow: false } };

const SAVED: Record<string, string> = { details: "✅ Details saved.", menu: "✅ Menu saved.", allergens: "✅ Allergens confirmed.", brand: "✅ Email look saved.", voice: "✅ Saved.", owner: "✅ Saved.", reverted: "✅ Reverted.", builder: "✅ Builder controls saved.", calendar: "✅ Calendar updated.", asked: "✅ The owner has been asked on WhatsApp.", teams: "✅ Teams saved.", benchmark: "✅ Nearby comparison saved." };

// Change anything set up during onboarding. (Or just message Naila on WhatsApp:
// "change Friday hours to 11pm", "add lamb chops, £14".)
export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  await connection(); // fresh on every visit (it shows today's hours)
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner(`/settings${one("r") ? `?r=${one("r")}` : ""}`);
  const restaurantId = pickRestaurantId(owner, one("r"));
  if (!restaurantId) return <Page narrow>No restaurant found for this login.</Page>;
  const r = await getRestaurant(restaurantId);
  // The menu with dish ids, so an edit (even a rename) keeps the same dishes.
  const menu = await menuWithIds(restaurantId);
  const unconfirmed = (r.menu ?? []).some((c) => c.items.some((i) => !i.allergens_confirmed));
  const { count: customerCount } = await getSupabase()
    .from("customers")
    .select("id", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .is("deleted_at", null);
  const label = "text-sm font-medium";
  const dishes = (r.menu ?? []).flatMap((c) => c.items);
  const toConfirm = dishes.filter((i) => !i.allergens_confirmed).length;
  const todayName = new Date().toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
  const hoursToday = r.opening_hours?.[todayName] ?? null;
  const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");
  const choices = await restaurantChoices(owner);

  return (
    <Page narrow>
      <RestaurantSwitcher choices={choices} current={restaurantId} path="/settings" />
      <PageHeader eyebrow="Settings" title="Settings" sub={<>Or just tell me on WhatsApp, e.g. “change Friday hours to 11pm”. Send UNDO to take back any change.</>} />
      <div className="space-y-4">
        <BillingBanner r={r} />
        {one("saved") && <Notice>{SAVED[one("saved")!] ?? `✅ ${one("saved")}`}</Notice>}
        {one("error") && <Notice tone="neg">{one("error")}</Notice>}
      </div>

      <div className="mb-8 mt-2 space-y-6">
        <Panel className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3.5">
            {r.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- the owner's own uploaded logo
              <img src={r.logo_url} alt="" className="h-12 w-12 shrink-0 rounded-xl bg-white object-contain p-1" />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-[15px] font-semibold text-white" style={{ background: r.brand_color || "#8b1e1e" }}>
                {initials(r.name)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-[16px] font-medium text-[#edefe8]">{r.name}</div>
              <div className="truncate text-[13px] text-[#a3a99d]">{r.address ?? "No address yet"}</div>
            </div>
          </div>
          <a href="#details" className="shrink-0 rounded-full bg-[#1e221b] px-3 py-1.5 text-[13px] text-[#c8f03c]">
            Edit details
          </a>
        </Panel>

        <SetupChapters restaurant={r} />

        <SettingsGroup title="Your restaurant">
          <Row href="#details" icon="settings" label="Details and opening hours" value={hoursToday ? `Today ${hoursToday}` : undefined} />
          <Row href="#menu" icon="report" label="Menu" value={`${dishes.length} dish${dishes.length === 1 ? "" : "es"}`} />
          {dishes.length > 0 && <Row href="#allergens" icon="shield" label="Allergens" value={toConfirm ? <Pill tone="amber">{toConfirm} to confirm</Pill> : <Pill tone="signal">All confirmed</Pill>} />}
        </SettingsGroup>

        <SettingsGroup title="How you sound">
          <Row href="#voice" icon="whatsapp" label="Brand voice" value={r.brand_voice ? <span className="max-w-[10rem] truncate">{r.brand_voice}</span> : undefined} />
          <Row
            href="#emails"
            icon="mail"
            label="How your emails look"
            value={
              <span className="flex -space-x-1.5">
                <span className="h-3.5 w-3.5 rounded-full ring-2 ring-[#171a14]" style={{ background: r.brand_dark }} />
                <span className="h-3.5 w-3.5 rounded-full ring-2 ring-[#171a14]" style={{ background: r.brand_color }} />
              </span>
            }
          />
        </SettingsGroup>

        <SettingsGroup title="Offers and sending">
          <Row href="#details" icon="spark" label="Sign-up reward" value={r.signup_reward ?? "Not set"} />
          <Row href="#details" icon="shield" label="Biggest discount allowed" value={`${r.discount_cap_percent}%`} />
          <Row icon="pause" label="Sending hours" value={`${hhmm(r.send_window_start)}–${hhmm(r.send_window_end)}`} sub={r.paused ? "Paused: text RESUME to start again" : "Text PAUSE on WhatsApp to stop everything"} />
        </SettingsGroup>

        <SettingsGroup title="Connections">
          <Row href={`/settings/google?r=${restaurantId}`} icon="google" label="Google Business Profile" value={r.google_location_id ? <Pill tone="signal">Connected</Pill> : <Pill tone="amber">Not connected</Pill>} />
          <Row href="#spreadsheets" icon="upload" label="Spreadsheets" />
          <Row href="#teams" icon="calendar" label="Local teams and calendar" />
        </SettingsGroup>

        <SettingsGroup title="Customers and account">
          <Row href={`/customers?r=${restaurantId}`} icon="customers" label="Customer list" value={`${customerCount ?? 0}`} />
          <Row href="#comparison" icon="sales" label="Nearby comparison" value={r.benchmark_opt_out ? "Off" : "On"} />
          <Row href="#billing" icon="report" label="Plan and billing" />
          <Row href="#history" icon="activity" label="Change history" />
        </SettingsGroup>
      </div>

      <div className="space-y-5 [&>*]:scroll-mt-20">
        <div id="billing" className="scroll-mt-20" />
        <BillingCard r={r} />
        <ReferralCard r={r} />
        <div id="google" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">Google Business Profile</h2>
          <p className="text-stone-700">{r.google_location_id ? `Connected: ${r.google_location_title ?? "your listing"}.` : "Not connected yet. Connect it so the replies and posts you approve go straight onto Google."}</p>
          {googleDryRun(r, "replies", dryRunContext(process.env)) && (
            <p className="text-sm text-stone-600">🧪 Dry run: what you approve for Google shows as &quot;would have posted&quot; on WhatsApp and in your log, and nothing changes on Google. Only DinerAI can switch this.</p>
          )}
          <Link href={`/settings/google?r=${restaurantId}`} className="text-sm font-medium text-emerald-700 underline">
            {r.google_location_id ? "Manage Google" : "Connect Google"}
          </Link>
        </Card>
        <div id="details" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">Details</h2>
          <form action={saveDetails} className="space-y-4">
            <input type="hidden" name="r" value={restaurantId} />
            <fieldset className="space-y-2">
              <legend className={label}>Opening hours</legend>
              {DAYS.map((day) => (
                <label key={day} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm">{day}</span>
                  <input name={`hours_${day}`} defaultValue={r.opening_hours?.[day] ?? ""} placeholder="12:00 – 22:00 or Closed" className={input} />
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className={label}>Phone</span>
              <input name="phone" type="tel" defaultValue={r.phone ?? ""} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Address</span>
              <input name="address" defaultValue={r.address ?? ""} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Website</span>
              <input name="website" inputMode="url" defaultValue={r.website ?? ""} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Sign-up reward</span>
              <input name="reward" defaultValue={r.signup_reward ?? ""} maxLength={100} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Biggest discount (%)</span>
              <input name="cap" type="number" min={0} max={100} defaultValue={r.discount_cap_percent} className={`mt-1 ${input}`} />
              <span className="mt-1 block text-xs text-stone-500">A free item or £ off counts as a % of the dish it comes with (a free £3.50 drink with an £18.50 platter is 19%).</span>
            </label>
            <label className="block">
              <span className={label}>Least profit on a dish after an offer (%)</span>
              <input name="min_margin" type="number" min={0} max={90} placeholder="50" defaultValue={r.min_margin_pct ?? ""} className={`mt-1 ${input}`} />
              <span className="mt-1 block text-xs text-stone-500">50% is recommended. Offers that would take a dish (with a cost in the menu below) under this are stopped. Empty means 50%.</span>
            </label>
            <fieldset>
              <legend className={label}>Kinds of offer you&apos;re happy to run</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {OFFER_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`offer_${t}`} value="yes" defaultChecked={(r.approved_offer_types ?? []).includes(t)} className="h-5 w-5" /> {OFFER_TYPE_LABELS[t]}
                  </label>
                ))}
              </div>
              <span className="mt-1 block text-xs text-stone-500">Naila only suggests these kinds of offer.</span>
            </fieldset>
            <label className="block">
              <span className={label}>Birthday offer</span>
              <input name="birthday_offer" defaultValue={r.birthday_offer ?? ""} placeholder="Free dessert in your birthday week" maxLength={100} className={`mt-1 ${input}`} />
              <span className="mt-1 block text-xs text-stone-500">Used in the weekly birthday email. Leave empty and Naila will ask you.</span>
            </label>
            <button className={button}>Save details</button>
          </form>
        </Card>

        <OwnerCard r={r} />

        <div id="voice" className="scroll-mt-20" />
        <VoiceCard r={r} />

        <div id="emails" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">How your emails look</h2>
          <p className="text-sm text-stone-600">Customers&apos; emails come from &quot;{r.name}&quot; and use your logo and colours. Replies go to your reply-to email.</p>
          <form action={saveBrand} className="space-y-4">
            <input type="hidden" name="r" value={restaurantId} />
            <div className="flex items-center gap-4">
              {r.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- the owner's own uploaded logo
                <img src={r.logo_url} alt="Your logo" className="h-14 w-auto rounded-lg border border-stone-200" />
              ) : (
                <span className="text-sm text-stone-500">No logo yet.</span>
              )}
              {r.logo_url && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="remove_logo" value="yes" /> Remove
                </label>
              )}
            </div>
            <label className="block">
              <span className={label}>Logo (PNG or JPEG, up to 2 MB)</span>
              <input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="mt-1 block w-full text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block">
                <span className={label}>Button colour</span>
                <input name="brand_color" type="color" defaultValue={r.brand_color} className="mt-1 h-12 w-full rounded-xl border border-stone-300" />
              </label>
              <label className="block">
                <span className={label}>Header colour</span>
                <input name="brand_dark" type="color" defaultValue={r.brand_dark} className="mt-1 h-12 w-full rounded-xl border border-stone-300" />
              </label>
            </div>
            <label className="block">
              <span className={label}>Tagline (under your name)</span>
              <input name="tagline" defaultValue={r.tagline ?? ""} maxLength={80} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Reply-to email (where customers&apos; replies go)</span>
              <input name="reply_to_email" type="email" defaultValue={r.reply_to_email ?? ""} placeholder={r.owner_email ?? "you@example.com"} className={`mt-1 ${input}`} />
            </label>
            <label className="flex items-start gap-3 text-sm">
              <input name="feedback_emails" type="checkbox" value="yes" defaultChecked={r.feedback_emails !== false} className="mt-0.5 h-5 w-5" />
              <span>Send &quot;How was your visit?&quot; emails about 3 hours after a reward or offer is used (at most once a month per customer). Everyone gets your Google review link.</span>
            </label>
            <button className={button}>Save</button>
          </form>
          <p className="text-sm text-stone-600">
            Preview:{" "}
            {(["confirm", "welcome", "feedback"] as const).map((k, i) => (
              <span key={k}>
                {i > 0 && " · "}
                <a href={`/settings/email-preview?r=${restaurantId}&kind=${k}`} target="_blank" className="text-emerald-700 underline">
                  {k === "confirm" ? "confirm email" : k === "welcome" ? "welcome email" : "feedback email"}
                </a>
              </span>
            ))}
            . Or text <b>EMAIL PREVIEWS</b> on WhatsApp.
          </p>
        </Card>

        <div id="customers" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">Your customers</h2>
          <p className="text-sm text-stone-600">
            {customerCount ?? 0} customer{customerCount === 1 ? "" : "s"} on your list. It&apos;s your data: download it any time (or text <b>EXPORT CUSTOMERS</b>). Every download is recorded in your activity log.
          </p>
          <a href={`/export/customers?r=${restaurantId}`} className={button}>
            Download customer list (CSV)
          </a>
        </Card>

        <div id="comparison" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">Nearby comparison</h2>
          <form action={saveBenchmark} className="space-y-4">
            <input type="hidden" name="r" value={restaurantId} />
            <label className="flex items-start gap-3 text-sm">
              <input name="benchmark" type="checkbox" value="yes" defaultChecked={!r.benchmark_opt_out} className="mt-0.5 h-5 w-5" />
              <span>
                Compare my month with other DinerAI restaurants nearby in my monthly report. Only the middle figure of 5 or more restaurants is ever shown, never any
                restaurant&apos;s name or own numbers. If you switch this off, your figures are left out of everyone&apos;s comparison and your report doesn&apos;t
                get one either.
              </span>
            </label>
            <button className={button}>Save</button>
          </form>
        </Card>

        <div id="menu" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">Menu</h2>
          {(r.menu ?? []).length ? null : <p className="text-sm text-stone-600">No menu yet. Add dishes below, or send photos of your menu on WhatsApp during set-up.</p>}
          <MenuEditor
            initial={menu.length ? menu : [{ category: "Menu", items: [{ name: "", price: 0, description: null }] }]}
            save={saveSettingsMenu.bind(null, restaurantId)}
            label="Save menu"
            showCost
          />
          <p className="mt-2 text-xs text-stone-500">Cost: roughly what each dish costs you to make (ingredients per plate). An estimate is fine. It shows which dishes make the most money, so offers push those. Never shown to customers.</p>
        </Card>

        <div id="spreadsheets" className="scroll-mt-20" />
        <Card>
          <h2 className="text-lg font-bold">Spreadsheets</h2>
          <p className="text-sm text-stone-600">Easier at a laptop: download a sheet, fill it in, then upload it here (or send it to me on WhatsApp). Text SPREADSHEETS on WhatsApp for these links on your phone.</p>
          <ul className="mt-3 space-y-2 text-sm">
            {TEMPLATE_KINDS.map((k) => (
              <li key={k}>
                <a href={safeTemplateUrls(r.id)?.[k] ?? "#"} className="font-medium text-emerald-700 underline">
                  ⬇️ {TEMPLATE_LABELS[k]}
                </a>
                <span className="text-stone-500">
                  {" "}
                  {k === "menu_costs" ? "(your dishes filled in: add what each costs to make)" : k === "staff" ? "(one row per person, for your rotas)" : k === "daily_takings" ? "(only if your till can't export your sales)" : "(what to ask your till for; nothing to fill in)"}
                </span>
              </li>
            ))}
          </ul>
          <form action={uploadSheet} className="mt-4 space-y-2">
            <input type="hidden" name="r" value={r.id} />
            <input name="sheet" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="block w-full text-sm" />
            <button className={button}>Upload a filled-in sheet</button>
          </form>
          <p className="mt-2 text-xs text-stone-500">Download links work for {TEMPLATE_LINK_DAYS} days. Your costs are private: never shown to customers.</p>
        </Card>

        <div id="allergens" className="scroll-mt-20" />
        {(r.menu ?? []).length > 0 && (
          <Card>
            <h2 className="text-lg font-bold">Allergens</h2>
            <p className="text-sm text-stone-600">
              {unconfirmed ? "⚠️ Some dishes' allergens aren't confirmed yet, so customers aren't told about them. " : "All confirmed. "}
              Tap a dish to change it; saving confirms every dish as shown.
            </p>
            <AllergenEditor initial={menu} save={saveSettingsAllergens.bind(null, restaurantId)} label="Confirm allergens" />
          </Card>
        )}

        {r.brand_voice && (
          <Card>
            <h2 className="text-lg font-bold">How you sound</h2>
            <p className="text-sm text-stone-700">{r.brand_voice}</p>
            <p className="text-sm text-stone-500">It keeps learning from your edits and the reasons you give when you skip a draft.</p>
          </Card>
        )}

        <div id="teams" className="scroll-mt-20" />
        <TeamsCard restaurantId={restaurantId} />

        <div id="history" className="scroll-mt-20" />
        <HistoryCard restaurantId={restaurantId} />

        {owner.isBuilder && <BuilderCard r={r} />}
        {owner.isBuilder && <OutsideDataCard r={r} />}
        {owner.isBuilder && <CalendarCard restaurantId={restaurantId} />}
        {owner.isBuilder && <CostCard restaurantId={restaurantId} />}
      </div>
    </Page>
  );
}

// A titled group of rows, like a phone's settings app.
function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <Eyebrow className="px-1">{title}</Eyebrow>
      <ListCard>{children}</ListCard>
    </section>
  );
}

// Everything setup asked, chapter by chapter (the same 9 chapters as onboarding,
// 7 Nov 2026): each opens the chat at that chapter, where its recap has a Change
// for every answer.
async function SetupChapters({ restaurant }: { restaurant: Awaited<ReturnType<typeof getRestaurant>> }) {
  const { dinaSetup } = await import("@/lib/dashboard/data");
  const view = await dinaSetup(restaurant).catch(() => null);
  if (!view) return null;
  const chapters = view.items.filter((s) => s.label !== "Link your WhatsApp");
  return (
    <SettingsGroup title="Your setup, chapter by chapter">
      {chapters.map((c) => (
        <Row key={c.label} href={c.href} icon="settings" label={c.label} value={c.done ? <Pill tone="signal">{c.status}</Pill> : <Pill tone="amber">{c.status}</Pill>} sub={c.detail ?? "Change any answer here"} />
      ))}
    </SettingsGroup>
  );
}
