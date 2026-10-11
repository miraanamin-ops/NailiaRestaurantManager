import { PROFILE_FIELDS, DEFAULT_EMOJI_ALLOWED } from "@/lib/profile/fields";
import { profileHistory, revertable, type ProfileVersion } from "@/lib/profile/versions";
import type { Restaurant } from "@/lib/supabase";
import { button, Card, input } from "../onboarding/ui";
import type { AgentName } from "@/lib/agents/definition";
import { agentMode, MODES_AVAILABLE } from "@/lib/agents/modes";
import { NEVER_AUTO, TASK_LABELS, TASKS, TRUST_LEVELS, trustLevel, type TrustLevel } from "@/lib/trust";
import { revertProfile, saveBuilderControls, saveVoice } from "./actions";

// Settings cards for the restaurant profile: how replies and messages sound
// (fields the agents use), and the profile's change history with Revert.

const label = "text-sm font-medium";
const hint = "mt-1 block text-xs text-stone-500";

export function VoiceCard({ r }: { r: Restaurant }) {
  const emoji = r.emoji_allowed ?? DEFAULT_EMOJI_ALLOWED;
  return (
    <Card>
      <h2 className="text-lg font-bold">How replies and messages sound</h2>
      <p className="text-sm text-stone-600">Naila only ever says what&apos;s written here about halal food, allergens and making things right. Leave a box empty if you&apos;d rather be asked each time.</p>
      <form action={saveVoice} className="space-y-4">
        <input type="hidden" name="r" value={r.id} />
        <label className="block">
          <span className={label}>Sign off replies as</span>
          <input name="sign_off_name" defaultValue={r.sign_off_name ?? ""} placeholder="Bilal and the team" maxLength={60} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Greeting</span>
          <input name="greeting" defaultValue={r.greeting ?? ""} placeholder="Salaam" maxLength={40} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Where unhappy customers should get in touch</span>
          <input name="complaint_contact" defaultValue={r.complaint_contact ?? ""} placeholder="hello@yourrestaurant.co.uk" maxLength={120} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Ways you&apos;re happy to put things right</span>
          <textarea name="recovery_offers" defaultValue={(r.recovery_offers ?? []).join("\n")} rows={3} placeholder={"Free dessert on your next visit"} className={`mt-1 ${input}`} />
          <span className={hint}>One per line. Only offered when a review describes a clear problem.</span>
        </label>
        <label className="block">
          <span className={label}>Halal statement (your exact words)</span>
          <textarea name="halal_statement" defaultValue={r.halal_statement ?? ""} rows={2} maxLength={500} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Allergen statement (your exact words)</span>
          <textarea name="allergen_statement" defaultValue={r.allergen_statement ?? ""} rows={2} maxLength={500} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className={label}>Words to avoid</span>
          <input name="words_to_avoid" defaultValue={(r.words_to_avoid ?? []).join(", ")} placeholder="cheap, deal" className={`mt-1 ${input}`} />
          <span className={hint}>Separate with commas.</span>
        </label>
        <fieldset>
          <legend className={label}>Most emojis allowed</legend>
          <div className="mt-1 grid grid-cols-3 gap-3">
            {(
              [
                ["emoji_review_replies", "Review replies", emoji.review_replies],
                ["emoji_posts", "Google posts", emoji.posts],
                ["emoji_campaigns", "Offer emails", emoji.campaigns],
              ] as const
            ).map(([name, text, value]) => (
              <label key={name} className="block text-xs text-stone-600">
                {text}
                <input name={name} type="number" min={0} max={5} defaultValue={value} className={`mt-1 ${input}`} />
              </label>
            ))}
          </div>
        </fieldset>
        <button className={button}>Save</button>
      </form>
    </Card>
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function show(v: unknown) {
  if (v == null || v === "") return "empty";
  const text = typeof v === "string" ? v : JSON.stringify(v);
  return text.length > 60 ? `${text.slice(0, 60)}…` : text;
}

export async function HistoryCard({ restaurantId }: { restaurantId: string }) {
  let history: ProfileVersion[] = [];
  try {
    history = await profileHistory(restaurantId, 15);
  } catch {
    // Before supabase/018_profile_v1.sql has been run there's no history yet.
  }
  const canRevert = revertable(history);
  return (
    <Card>
      <h2 className="text-lg font-bold">Profile history</h2>
      <p className="text-sm text-stone-600">Every change to your restaurant&apos;s details, newest first. Revert puts that one detail back as it was.</p>
      {!history.length && <p className="text-sm text-stone-500">No changes yet.</p>}
      <ul className="divide-y divide-stone-100">
        {history.map((v) => (
          <li key={v.id} className={`flex items-center gap-3 py-2.5 ${v.reverted_at ? "opacity-50" : ""}`}>
            <div className="min-w-0 flex-1 text-sm">
              <p>
                <b>{PROFILE_FIELDS[v.field]?.label ?? v.field}</b>: {show(v.old_value)} → {show(v.new_value)}
                {v.reverted_at && <span className="ml-1 text-xs text-stone-500">(reverted)</span>}
              </p>
              <p className="text-xs text-stone-500">
                {when(v.created_at)} · v{v.version} · by {v.changed_by}
              </p>
            </div>
            {canRevert.has(v.id) && (
              <form action={revertProfile}>
                <input type="hidden" name="r" value={restaurantId} />
                <input type="hidden" name="version" value={v.id} />
                <button className="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-900 ring-1 ring-stone-300">Revert</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

// Builder only: trust level per task, and each agent's mode. Owners never see this.
export function BuilderCard({ r }: { r: Restaurant }) {
  const levelNames: Record<TrustLevel, string> = { draft_only: "Draft only", approve: "Approve", auto: "Auto" };
  return (
    <Card>
      <h2 className="text-lg font-bold">Builder controls</h2>
      <p className="text-sm text-stone-600">
        Only you can see this. Every task starts on Approve. Auto sends without a tap, but only once the checker agent is live and has passed that exact draft. Campaigns, offers, hours, menu and profile changes can never be Auto.
      </p>
      <form action={saveBuilderControls} className="space-y-4">
        <input type="hidden" name="r" value={r.id} />
        <fieldset className="space-y-2">
          <legend className={label}>Trust level per task</legend>
          {TASKS.map((task) => (
            <label key={task} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-sm">{TASK_LABELS[task]}</span>
              <select name={`trust_${task}`} defaultValue={trustLevel(r.trust_levels, task)} className={input}>
                {TRUST_LEVELS.filter((l) => l !== "auto" || !NEVER_AUTO.has(task)).map((l) => (
                  <option key={l} value={l}>
                    {levelNames[l]}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        <fieldset className="space-y-2">
          <legend className={label}>Agents</legend>
          {Object.entries(MODES_AVAILABLE).map(([agent, available]) => (
            <label key={agent} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-sm capitalize">{agent}</span>
              <select name={`mode_${agent}`} defaultValue={agentMode(r, agent as AgentName)} className={input}>
                {available.allowed.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </fieldset>
        <button className={button}>Save builder controls</button>
      </form>
    </Card>
  );
}
