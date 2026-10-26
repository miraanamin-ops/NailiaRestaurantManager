import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { londonYmd } from "@/lib/clock";
import { db, must } from "@/lib/ops/db";
import { getRestaurant } from "@/lib/onboarding/store";
import { nextWeekStart, rotaUrl, type RotaWeek } from "@/lib/rota/build";
import { weekLabel } from "@/lib/rota/message";
import { DEFAULT_RULES, ROLE_LABELS, ROLES, roleKey, rotaSettings } from "@/lib/rota/rules";
import { availabilityText, team, type TeamMember } from "@/lib/rota/staff";
import type { RotaRuleRow } from "@/lib/ops/types";
import { button, Card, Frame, input } from "../onboarding/ui";
import { removeMember, saveMember, saveRules } from "./actions";

export const metadata: Metadata = { title: "Team", robots: { index: false, follow: false } };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// The rota team and rules. (Or on WhatsApp: "add Ali, kitchen, £13, weekdays", TEAM.)
export default function StaffPage({ searchParams }: PageProps<"/staff">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Staff searchParams={searchParams} />
    </Suspense>
  );
}

async function Staff({ searchParams }: Pick<PageProps<"/staff">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner(`/staff${one("r") ? `?r=${one("r")}` : ""}`);
  const restaurantId = pickRestaurantId(owner, one("r"));
  if (!restaurantId) return <Frame>No restaurant found for this login.</Frame>;
  const today = londonYmd(new Date());
  const weekStart = nextWeekStart(today);
  const [r, members, rulesRes, weekRes] = await Promise.all([
    getRestaurant(restaurantId),
    team(restaurantId, today),
    db().from("rota_rules").select("*").eq("restaurant_id", restaurantId),
    db().from("rota_weeks").select("*").eq("restaurant_id", restaurantId).eq("week_start", weekStart).maybeSingle(),
  ]);
  const saved = (must(rulesRes, "rota rules") ?? []) as RotaRuleRow[];
  const week = must(weekRes, "rota week") as RotaWeek | null;
  const settings = rotaSettings((r as { rota_settings?: Record<string, unknown> | null }).rota_settings);
  const rule = (role: string) => saved.find((x) => roleKey(x.role) === role) ?? null;
  const label = "text-sm font-medium";

  return (
    <Frame>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{r.name}: team &amp; rota</h1>
      <p className="mb-4 text-sm text-stone-600">
        Every Thursday at 10am I suggest next week&apos;s rota on WhatsApp: the cheapest person free for each shift, within these rules. You can also message me, e.g. <i>add Ali, kitchen, £13, weekdays</i>.
      </p>
      {one("saved") && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">✅ {one("saved")}</p>}
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

      <div className="space-y-5">
        <Card>
          <h2 className="text-lg font-bold">Next week ({weekLabel(weekStart)})</h2>
          {week?.status === "published" && week.share_token ? (
            <p className="text-stone-700">
              Approved.{" "}
              <a className="text-emerald-700 underline" href={rotaUrl(week.share_token)}>
                Open the rota
              </a>{" "}
              ·{" "}
              <a className="text-emerald-700 underline" href={`${rotaUrl(week.share_token)}/pdf`}>
                PDF
              </a>
            </p>
          ) : week?.draft_id ? (
            <p className="text-stone-700">A draft is waiting for you on WhatsApp (text ROTA to see it again).</p>
          ) : (
            <p className="text-stone-700">Not suggested yet: it comes on Thursday at 10am.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Team ({members.length})</h2>
          {members.length === 0 && <p className="text-stone-600">Nobody yet. Add your first person below.</p>}
          <ul className="space-y-3">
            {members.map((m) => (
              <li key={m.id} className="rounded-xl border border-stone-200 p-3">
                <details>
                  <summary className="cursor-pointer list-none">
                    <span className="font-semibold">{m.name}</span>
                    <span className="text-sm text-stone-600">
                      {" "}
                      · {m.roles.map((x) => (ROLE_LABELS[roleKey(x)] ?? x).toLowerCase()).join(", ")} · {m.ratePence !== null ? `£${(m.ratePence / 100).toFixed(2)}/h` : "no rate"}
                      {m.maxHours !== null ? ` · max ${m.maxHours}h` : ""}
                    </span>
                    <span className="block text-xs text-stone-500">{availabilityText(m.availability)} · tap to change</span>
                  </summary>
                  <div className="mt-3 space-y-3">
                    <MemberForm restaurantId={restaurantId} member={m} />
                    <form action={removeMember}>
                      <input type="hidden" name="r" value={restaurantId} />
                      <input type="hidden" name="staff_id" value={m.id} />
                      <button className="text-sm text-red-700 underline">Remove {m.name} from the team</button>
                    </form>
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Add someone</h2>
          <MemberForm restaurantId={restaurantId} member={null} />
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Rota rules</h2>
          <form action={saveRules} className="space-y-4">
            <input type="hidden" name="r" value={restaurantId} />
            <p className="text-sm text-stone-600">
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
        </Card>
      </div>
    </Frame>
  );
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
