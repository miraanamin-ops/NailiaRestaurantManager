import "server-only";
import { londonYmd } from "@/lib/clock";
import { csvCell } from "@/lib/customer-csv";
import { check } from "@/lib/drafts";
import { noteText } from "@/lib/feeds/builder-parse";
import { simulatedDay } from "@/lib/simulation-rules";
import { getSupabase, type Restaurant } from "@/lib/supabase";

// The Pilot Zero log (docs/pilot-zero.md, phase 6): "#note ..." from the builder's
// own WhatsApp number (the webhook checks BUILDER_WHATSAPP before calling this),
// saved with the simulated date if the builder's restaurant is simulating, else
// today's. Never reaches the assistant or Dina. Exported as CSV from the Pilot Zero
// page. Notes stay if the restaurant is closed (they're the builder's, not its data).

const MISSING = new Set(["42P01", "PGRST205"]);

export type PilotNote = { id: string; restaurant_id: string | null; day: string; simulated: boolean; note: string; created_at: string };

// Saves a note; returns the reply for the builder.
export async function saveNote(input: { body: string; restaurantId: string | null; messageSid: string | null; now?: Date }) {
  const text = noteText(input.body);
  if (!text) return "📝 Nothing to note. Write it after #note, e.g. #note the brief came at 9:02.";
  const now = input.now ?? new Date();
  const r = input.restaurantId ? check(await getSupabase().from("restaurants").select("*").eq("id", input.restaurantId).maybeSingle<Restaurant>()) : null;
  const sim = r ? simulatedDay(r, londonYmd) : null;
  const day = sim ?? londonYmd(now);
  const { error } = await getSupabase()
    .from("pilot_notes")
    .insert({ restaurant_id: r?.id ?? null, day, simulated: Boolean(sim), note: text, message_sid: input.messageSid });
  if (error?.code === "23505") return null; // Twilio delivered it twice: noted once, answered once
  if (error && MISSING.has(error.code)) return "⚠️ Not saved: notes need supabase/056_pilot_zero.sql on this database.";
  if (error) throw new Error(error.message);
  return `📝 Noted for ${day}${sim ? " (simulated day)" : ""}.`;
}

export async function recentNotes(limit = 20) {
  const res = await getSupabase().from("pilot_notes").select("*").order("created_at", { ascending: false }).limit(limit);
  if (res.error && MISSING.has(res.error.code)) return null;
  return (check(res) ?? []) as PilotNote[];
}

// Every note, oldest first, as CSV (formula-safe cells).
export async function notesCsv() {
  const supabase = getSupabase();
  const notes: PilotNote[] = [];
  for (let from = 0; ; from += 1000) {
    const page = (check(await supabase.from("pilot_notes").select("*").order("created_at", { ascending: true }).range(from, from + 999)) ?? []) as PilotNote[];
    notes.push(...page);
    if (page.length < 1000) break;
  }
  const ids = [...new Set(notes.map((n) => n.restaurant_id).filter((x): x is string => Boolean(x)))];
  const names = ids.length ? ((check(await supabase.from("restaurants").select("id, name").in("id", ids)) ?? []) as { id: string; name: string }[]) : [];
  const written = (iso: string) => new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "short", timeStyle: "short" });
  const lines = [["Date", "Simulated", "Restaurant", "Note", "Written at (UK time)"].map(csvCell).join(",")];
  for (const n of notes) lines.push([n.day, n.simulated ? "Yes" : "No", names.find((x) => x.id === n.restaurant_id)?.name ?? "", n.note, written(n.created_at)].map(csvCell).join(","));
  return { csv: lines.join("\r\n") + "\r\n", count: notes.length };
}
