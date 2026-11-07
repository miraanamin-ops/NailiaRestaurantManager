import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import { Icon } from "@/components/icons";
import { RestaurantSwitcher } from "@/components/restaurant-switcher";
import { btnGhost, btnPrimary, btnSecondary, Eyebrow, Notice, Page, PageHeader, Panel, Pill, Section, WhatsAppTip } from "@/components/ui";
import { londonYmd } from "@/lib/clock";
import { ownerPage } from "@/lib/dashboard/page-context";
import { initials } from "@/lib/dashboard/rules";
import { ourWhatsAppNumber } from "@/lib/onboarding/channel";
import { whatsAppLink } from "@/lib/onboarding/steps";
import { db, must } from "@/lib/ops/db";
import { nextWeekStart, rotaUrl, type RotaWeek } from "@/lib/rota/build";
import { weekLabel } from "@/lib/rota/message";
import { DEFAULT_RULES, ROLE_LABELS, ROLES, roleKey, rotaSettings } from "@/lib/rota/rules";
import { availabilityText, team, type TeamMember } from "@/lib/rota/staff";
import type { RotaRuleRow } from "@/lib/ops/types";
import { gbp } from "@/lib/sales/format";
import { button, input } from "../onboarding/ui";
import { removeMember, saveMember, saveRules } from "./actions";

export const metadata: Metadata = { title: "Team · DinerAI", robots: { index: false, follow: false } };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The rota team and rules: next week's labour cost, the rota at a glance, who's on
// the team, and the rules the rota follows. (Or on WhatsApp: "add Ali, kitchen,
// £13, weekdays", TEAM, ROTA.)
export default function StaffPage({ searchParams }: PageProps<"/staff">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Staff searchParams={searchParams} />
    </Suspense>
  );
}

async function Staff({ searchParams }: Pick<PageProps<"/staff">, "searchParams">) {
  const { owner, restaurant, choices, one } = await ownerPage("/staff", searchParams);
  if (!restaurant) return <Page narrow>No restaurant found for {owner.email}.</Page>;
  const restaurantId = restaurant.id;
  const today = londonYmd(new Date());
  const weekStart = nextWeekStart(today);
  const [members, rulesRes, weekRes] = await Promise.all([
    team(restaurantId, today),
    db().from("rota_rules").select("*").eq("restaurant_id", restaurantId),
    db().from("rota_weeks").select("*").eq("restaurant_id", restaurantId).eq("week_start", weekStart).maybeSingle(),
  ]);
  const saved = (must(rulesRes, "rota rules") ?? []) as RotaRuleRow[];
  const week = must(weekRes, "rota week") as RotaWeek | null;
  const settings = rotaSettings((restaurant as { rota_settings?: Record<string, unknown> | null }).rota_settings);
  const rule = (role: string) => saved.find((x) => roleKey(x.role) === role) ?? null;
  const label = "text-sm font-medium";
  const plan = week?.summary ?? null;
  const target = Number(restaurant.labour_target_pct ?? 0) || null;
  const names = [...new Set((plan?.days ?? []).flatMap((d) => d.shifts.map((x) => x.name ?? "Open shift")))];
  const status =
    week?.status === "published"
      ? { label: "Approved", tone: "signal" as const }
      : week?.draft_id
        ? { label: "Suggested · waiting for you", tone: "amber" as const }
        : null;
  const over = Boolean(target && plan?.totals.labourPct != null && plan.totals.labourPct > target);

  return (
    <Page>
      <RestaurantSwitcher choices={choices} current={restaurantId} path="/staff" />
      <PageHeader
        eyebrow="Team"
        title="Team"
        sub="Every Thursday at 10am I suggest next week's rota on WhatsApp: the cheapest person free for each shift, within your rules."
        action={
          <a href="#add" className={btnPrimary}>
            + Add someone
          </a>
        }
      />
      <div className="space-y-4">
        {one("saved") && <Notice>{one("saved")}</Notice>}
        {one("error") && <Notice tone="neg">{one("error")}</Notice>}
      </div>

      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {plan && plan.totals.costPence > 0 && (
            <Panel className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Eyebrow>Labour · {weekLabel(weekStart)}</Eyebrow>
                  <div className="mt-1 text-[17px] font-semibold text-[#edefe8]">Next week&apos;s rota costs {gbp(plan.totals.costPence / 100)}</div>
                </div>
                {plan.totals.labourPct !== null && <Pill tone={over ? "neg" : "signal"}>{Math.round(plan.totals.labourPct)}% of sales</Pill>}
              </div>
              {plan.totals.labourPct !== null && (
                <div className="space-y-1.5">
                  <div className="relative h-2 rounded-full bg-[#1e221b]">
                    <div className={`h-full rounded-full ${over ? "bg-[#ff8a6e]" : "bg-[#c8f03c]"}`} style={{ width: `${Math.min(100, plan.totals.labourPct * 2)}%` }} />
                    {target && <div className="absolute -bottom-1 -top-1 w-0.5 bg-[#edefe8]/60" style={{ left: `${Math.min(100, target * 2)}%` }} title={`Target ${target}%`} />}
                  </div>
                  <div className="flex justify-between font-mono text-[11px] text-[#a3a99d]">
                    <span>{plan.totals.hours} hours</span>
                    <span>{target ? `Your target ${target}%` : "No target set yet"}</span>
                  </div>
                </div>
              )}
              {plan.flags.length > 0 && <p className="text-[13px] text-[#ffb23d]">{plan.flags[0].text}</p>}
            </Panel>
          )}

          <Section title="Next week's rota" aside={<Eyebrow>{weekLabel(weekStart)}</Eyebrow>}>
            <Panel className="space-y-4">
              {status && (
                <Pill tone={status.tone} dot>
                  {status.label}
                </Pill>
              )}
              {plan && names.length ? (
                <div className="overflow-x-auto">
                  <div className="min-w-[440px] space-y-1">
                    <div className="grid items-center gap-1 pb-1 text-center font-mono text-[11px] text-[#a3a99d]" style={{ gridTemplateColumns: "84px repeat(7, minmax(0,1fr))" }}>
                      <span className="text-left">Staff</span>
                      {plan.days.map((d) => (
                        <span key={d.date}>{DAYS[(new Date(`${d.date}T12:00:00Z`).getUTCDay() + 6) % 7].slice(0, 1)}</span>
                      ))}
                    </div>
                    {names.map((name) => (
                      <div key={name} className="grid items-center gap-1 rounded-lg py-1 hover:bg-[#1e221b]" style={{ gridTemplateColumns: "84px repeat(7, minmax(0,1fr))" }}>
                        <span className={`truncate pl-1 text-[13px] ${name === "Open shift" ? "text-[#ffb23d]" : "text-[#edefe8]"}`}>{name}</span>
                        {plan.days.map((d) => {
                          const shifts = d.shifts.filter((x) => (x.name ?? "Open shift") === name);
                          return (
                            <div key={d.date} className="flex flex-col items-center gap-0.5">
                              {shifts.length ? (
                                shifts.map((x, i) => (
                                  <span
                                    key={i}
                                    className={`rounded px-1 py-0.5 font-mono text-[10px] font-medium ${roleKey(x.role) === "kitchen" ? "bg-[#c8f03c]/15 text-[#c8f03c]" : "bg-[#bfe6ff]/12 text-[#bfe6ff]"}`}
                                  >
                                    {hm(x.start)}–{hm(x.end)}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] text-[#3a4034]">—</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex items-center gap-4 font-mono text-[11px] text-[#a3a99d]">
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#c8f03c]/30" /> Kitchen
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm bg-[#bfe6ff]/30" /> Other roles
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-[14px] text-[#a3a99d]">Not suggested yet: it comes on Thursday at 10am. Text ROTA on WhatsApp to see where it&apos;s up to.</p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {week?.status === "published" && week.share_token ? (
                  <>
                    <a className={btnSecondary} href={rotaUrl(week.share_token)}>
                      Open the rota
                    </a>
                    <a className={btnGhost} href={`${rotaUrl(week.share_token)}/pdf`}>
                      Download PDF
                    </a>
                  </>
                ) : week?.draft_id ? (
                  <a className={btnPrimary} href={whatsAppLink(ourWhatsAppNumber(), "ROTA")} target="_blank" rel="noreferrer">
                    Approve or change it on WhatsApp
                  </a>
                ) : null}
              </div>
              <p className="text-[12px] text-[#6e7468]">Changes are easiest by message, e.g. “Ali can&apos;t do Friday”.</p>
            </Panel>
          </Section>

          <Section title="Your team" count={members.length}>
            {members.length === 0 ? (
              <p className="text-[14px] text-[#a3a99d]">Nobody yet. Add your first person.</p>
            ) : (
              <div className="divide-y divide-[#1e221b] overflow-hidden rounded-2xl bg-[#171a14]">
                {members.map((m) => (
                  <details key={m.id} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-[#1e221b]">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1e221b] text-[13px] font-medium text-[#edefe8]">{initials(m.name)}</div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[14px] font-medium text-[#edefe8]">{m.name}</span>
                            {m.roles.map((x) => (
                              <Pill key={x}>{ROLE_LABELS[roleKey(x)] ?? x}</Pill>
                            ))}
                          </div>
                          <div className="truncate text-[12px] text-[#a3a99d]">
                            {availabilityText(m.availability)}
                            {m.maxHours !== null ? ` · max ${m.maxHours}h a week` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono text-[13px] text-[#edefe8]">{m.ratePence !== null ? `£${(m.ratePence / 100).toFixed(2)}/h` : "No rate"}</span>
                        <Icon name="chevron" className="h-4 w-4 text-[#a3a99d] transition group-open:rotate-90" />
                      </div>
                    </summary>
                    <div className="space-y-3 bg-[#121410] px-4 py-4">
                      <MemberForm restaurantId={restaurantId} member={m} />
                      <form action={removeMember}>
                        <input type="hidden" name="r" value={restaurantId} />
                        <input type="hidden" name="staff_id" value={m.id} />
                        <button className="text-[13px] text-[#ff8a6e] underline">Remove {m.name} from the team</button>
                      </form>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Add someone" id="add">
            <Panel>
              <MemberForm restaurantId={restaurantId} member={null} />
            </Panel>
          </Section>

          <Section title="Rota rules">
            <Panel>
              <form action={saveRules} className="space-y-4">
                <input type="hidden" name="r" value={restaurantId} />
                <p className="text-[13px] text-[#a3a99d]">
                  Whenever you&apos;re open: at least this many in each role, plus one more for every so many forecast orders in an hour (empty = never more).
                </p>
                <div className="space-y-2">
                  {ROLES.map((role) => {
                    const x = rule(role) ?? DEFAULT_RULES[role];
                    return (
                      <div key={role} className="grid grid-cols-[1fr_5rem_5rem] items-center gap-2">
                        <span className={label}>{ROLE_LABELS[role]}</span>
                        <label className="text-xs text-stone-500">
                          At least
                          <input name={`min_${role}`} type="number" min={0} max={20} defaultValue={x.min_on_shift} className={input} />
                        </label>
                        <label className="text-xs text-stone-500">
                          +1 per orders/h
                          <input name={`per_${role}`} type="number" min={1} step="0.5" defaultValue={x.orders_per_extra_staff ?? ""} className={input} />
                        </label>
                      </div>
                    );
                  })}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-stone-500">
                    Shortest shift (hours)
                    <input name="min_shift" type="number" min={1} max={12} defaultValue={settings.min_shift_hours} className={input} />
                  </label>
                  <label className="text-xs text-stone-500">
                    Longest shift (hours)
                    <input name="max_shift" type="number" min={1} max={16} defaultValue={settings.max_shift_hours} className={input} />
                  </label>
                  <label className="text-xs text-stone-500">
                    Flag anyone over (hours a week)
                    <input name="week_hours" type="number" min={1} max={100} defaultValue={settings.flag_week_hours} className={input} />
                  </label>
                  <label className="text-xs text-stone-500">
                    Flag less rest than (hours)
                    <input name="rest_hours" type="number" min={0} max={24} defaultValue={settings.flag_rest_hours} className={input} />
                  </label>
                </div>
                <p className="text-xs text-stone-500">With under 8 weeks of sales history, the rota uses only the minimums (there&apos;s no forecast to staff to yet).</p>
                <button className={button}>Save rules</button>
              </form>
            </Panel>
          </Section>

          <WhatsAppTip>
            You can also say on WhatsApp: <span className="text-[#edefe8]">“Sana is off Friday”</span> or <span className="text-[#edefe8]">“add Omar, front of house, £11.44”</span>.
          </WhatsAppTip>
        </div>
      </div>
    </Page>
  );
}

// Minutes after midnight as a short time: 1020 -> "5", 1050 -> "5:30" (past midnight wraps).
function hm(minutes: number) {
  const m = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60) % 12 || 12;
  return m % 60 ? `${h}:${String(m % 60).padStart(2, "0")}` : String(h);
}

function MemberForm({ restaurantId, member }: { restaurantId: string; member: TeamMember | null }) {
  const day = (wd: number) => member?.availability.find((a) => a.weekday === wd) ?? null;
  return (
    <form action={saveMember} className="space-y-3">
      <input type="hidden" name="r" value={restaurantId} />
      {member && <input type="hidden" name="staff_id" value={member.id} />}
      <input name="name" placeholder="Name, e.g. Ali" defaultValue={member?.name ?? ""} className={input} required maxLength={40} />
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="sr-only">Roles</legend>
        {ROLES.map((role) => (
          <label key={role} className="flex items-center gap-1.5">
            <input type="checkbox" name={`role_${role}`} value="yes" defaultChecked={member ? member.roles.map(roleKey).includes(role) : role === "kitchen"} />
            {ROLE_LABELS[role]}
          </label>
        ))}
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-stone-500">
          Hourly rate (£)
          <input name="rate" inputMode="decimal" placeholder="12.21" defaultValue={member?.ratePence != null ? (member.ratePence / 100).toFixed(2) : ""} className={input} />
        </label>
        <label className="text-xs text-stone-500">
          Max hours a week
          <input name="max" type="number" min={1} max={80} placeholder="no limit" defaultValue={member?.maxHours ?? ""} className={input} />
        </label>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="text-xs text-stone-500">Usually free (leave times empty for all day)</legend>
        {DAYS.map((d, i) => {
          const a = day(i + 1);
          const allDay = a && a.starts === "00:00" && a.ends === "23:59";
          return (
            <div key={d} className="grid grid-cols-[3.5rem_1fr_1fr] items-center gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" name={`day_${i + 1}`} value="yes" defaultChecked={member ? Boolean(a) : i < 5} />
                {d}
              </label>
              <input name={`from_${i + 1}`} type="time" defaultValue={a && !allDay ? a.starts : ""} className="rounded-lg border border-stone-300 px-2 py-1.5" aria-label={`${d} from`} />
              <input name={`to_${i + 1}`} type="time" defaultValue={a && !allDay ? a.ends : ""} className="rounded-lg border border-stone-300 px-2 py-1.5" aria-label={`${d} until`} />
            </div>
          );
        })}
      </fieldset>
      <button className={button}>{member ? `Save ${member.name}` : "Add to the team"}</button>
    </form>
  );
}
