import "server-only";
import { ownerChannel } from "@/lib/followups";
import { sendAndLog } from "@/lib/notify";
import { saveProfileFields } from "@/lib/profile-edits";
import { roleKey } from "@/lib/rota/rules";
import { saveStaff } from "@/lib/rota/staff";
import { londonYmd } from "@/lib/clock";
import { check } from "@/lib/drafts";
import { sendOwnerEmail } from "@/lib/email";
import { confirmImport, getImport, receivePosFile } from "@/lib/sales/pos-import";
import { amountBasis, basisWords, describeMapping, isDailyTotals, type PosMapping } from "@/lib/sales/pos-table";
import { readTable } from "@/lib/sales/pos-file";
import { appUrl, getSupabase } from "@/lib/supabase";
import { sendText } from "@/lib/whatsapp";
import { stepState, type FlowStepKey } from "../flow";
import { completeStep, loadFlow, noteStep, type Channel } from "../sessions";
import { getRestaurant } from "../store";
import { MAX_UPLOAD_BYTES } from "./uploads";
import { readSavedFile, type FilePart } from "./uploads-store";
import { whatsappWindowOpen } from "./say";
import {
  DEFAULT_LABOUR_TARGET,
  DEFAULT_SIGNUP_REWARD,
  hhmm,
  hourWords,
  rewardsProblems,
  MIN_SALES_WEEKS,
  SALES_GAP_LINE,
  salesCoverage,
  availabilityOf,
  teamProblems,
  timingProblems,
  type StaffInputRow,
  type TeamDraft,
} from "./ops-content";

// Steps 7 to 12 (11, languages and key dates, comes later). Code does the work,
// Dina talks; each save is checked here first and says exactly what it saved:
//   7. sales: a CSV or Excel export through the sales importer we already have
//      (pos-import.ts). A layout we haven't seen asks once which column is which
//      (confirm_sales_columns, or the import page to fix them); then "Got it:
//      11 months of sales, Nov 2025 to Oct 2026". Under 8 weeks is half done.
//   8. team: save_team, into the rota's team (saveStaff), its cover rules and
//      the labour target (30% if they don't say, flagged as a default).
//   9. rewards: save_rewards, the sign-up reward and the discount cap (the
//      release gate's cap), both checked against each other and the saved
//      "making it right" offers.
//  10. QR codes: send_qr_kit emails the printable pack and sends it on WhatsApp
//      (customer list import comes later).
//  12. timing: save_timing, the brief hour and the customer sending hours.

const today = () => londonYmd(new Date());
// The setup gap when the QR codes went out without a confirmed logo.
export const LOGO_GAP = "Send your logo and I'll put it on your emails, QR codes and Google posts.";
const dataOf = async (restaurantId: string, key: FlowStepKey) => stepState((await loadFlow(restaurantId)).state, key).data as Record<string, unknown>;

// ---------- 7. Sales history ----------

// Files sent on the sales step. Returns what Dina is told.
export async function readSalesFiles(restaurantId: string, files: FilePart[], channel: Channel) {
  const sheet = files.find((f) => f.kind === "csv" || f.kind === "excel");
  if (!sheet) return "None of those is a sales export. Ask for the CSV or Excel file from their till (photos of reports can't be read).";
  const bytes = await readSavedFile(restaurantId, sheet.path);
  const out = await receivePosFile({ restaurantId, bytes, contentType: sheet.contentType, fileName: sheet.path.split("/").pop() ?? null, channel, sentBy: null, actor: "owner", maxBytes: MAX_UPLOAD_BYTES });
  if (out.status === "failed") return `Code couldn't import that file: ${out.message} Tell them in a line and ask for the right export.`;
  if (out.status === "imported") return finishSales(restaurantId, channel);
  const row = await getImport(restaurantId, out.importId);
  await noteStep(restaurantId, "sales", { pending_import: out.importId }, { channel });
  const columns = row?.mapping ? describeMapping(row.mapping).join("; ") : "";
  return `Code read the file, but it's a layout we haven't seen, so check the columns once: ${columns}${row?.mapping?.pos_name ? ` (it looks like ${row.mapping.pos_name})` : ""}. Ask if that looks right, with quick_replies "Yes, import it" and "Not quite". Yes: call confirm_sales_columns. Not quite: give them this page to fix the columns, then ask them to tell you when it's done: ${appUrl()}/sales/import/${out.importId}?r=${restaurantId}`;
}

// "Yes, import it" (or they fixed the columns on the import page): import, then finish.
export async function confirmSalesColumns(restaurantId: string, channel: Channel) {
  const pending = (await dataOf(restaurantId, "sales")).pending_import;
  if (typeof pending !== "string") return { ok: false as const, text: "There's no sales file waiting. Ask them to send the export first." };
  const row = await getImport(restaurantId, pending);
  if (!row) return { ok: false as const, text: "That sales file has gone. Ask them to send it again." };
  if (row.status !== "imported") {
    if (!row.mapping) return { ok: false as const, text: `The columns still need choosing on the import page: ${appUrl()}/sales/import/${pending}?r=${restaurantId}` };
    const out = await confirmImport(restaurantId, pending, row.mapping);
    if (out.status !== "imported") return { ok: false as const, text: `Not imported: ${out.message}` };
  }
  return { ok: true as const, text: await finishSales(restaurantId, channel) };
}

// Everything imported so far (this file and any earlier), as one span. Daily
// takings alone are enough for forecasts; item sales add dish-level insights, so
// without any, a low-priority "item sales" gap is kept (never a blocker).
async function finishSales(restaurantId: string, channel: Channel) {
  const rows =
    check(
      await getSupabase()
        .from("pos_imports")
        .select("first_day, last_day, mapping, imported_at")
        .eq("restaurant_id", restaurantId)
        .eq("status", "imported")
        .returns<{ first_day: string | null; last_day: string | null; mapping: PosMapping | null; imported_at: string | null }[]>(),
    ) ?? [];
  const firsts = rows.map((r) => r.first_day).filter((d): d is string => Boolean(d)).sort();
  const lasts = rows.map((r) => r.last_day).filter((d): d is string => Boolean(d)).sort();
  if (!firsts.length) return "Code found no sales in that file. Ask them to check it's the sales export.";
  const cover = salesCoverage(firsts[0], lasts.at(-1)!);
  const itemsToo = rows.some((r) => Boolean(r.mapping?.item));
  // Forecasts work from takings alone; the number of orders each day sharpens them
  // (orders x average spend), so without it there's a low-priority "order counts" gap.
  const { count: withOrders } = await getSupabase()
    .from("sales_days")
    .select("day", { count: "exact", head: true })
    .eq("restaurant_id", restaurantId)
    .gte("day", firsts[0])
    .lte("day", lasts.at(-1)!)
    .gt("transactions", 0);
  const ordersOk = (withOrders ?? 0) >= MIN_SALES_WEEKS * 7;
  const extras = [...(itemsToo ? [] : ["sales_items"]), ...(ordersOk ? [] : ["order_counts"])];
  await completeStep(
    restaurantId,
    "sales",
    cover.enough ? "done" : "partial",
    {
      pending_import: null,
      first_day: firsts[0],
      last_day: lasts.at(-1),
      weeks: cover.weeks,
      days_with_orders: withOrders ?? 0,
      daily_only: !itemsToo,
      extra_gaps: extras,
      gap_unlock: cover.enough ? null : SALES_GAP_LINE,
    },
    { channel },
  );
  // At most one of the two reminders is said now (order counts first: they help forecasts); both are kept as low-priority gaps.
  const reminder = !ordersOk
    ? " There's no number of orders for most days, which is fine: forecasts work from the takings. In one line, say that order counts (transactions or receipts) make forecasts more accurate, whenever they can send them: a low-priority reminder, not something to do now."
    : itemsToo
      ? ""
      : " These are daily totals. In one short line, mention that a sales-by-item export is the most useful (it shows which dishes make the most), then sales by the hour, whenever suits: a low-priority reminder, not something to do now.";
  const column = ` Then say in one line which column the takings came from: ${columnUsed(rows)}.`;
  if (cover.enough) return `Code saved their sales: "Got it: ${cover.text}." Say that in those words.${column}${reminder}`;
  return `Code saved their sales (${cover.text}), but forecasts need at least 8 weeks, so the step is half done and a setup gap for later. Say so kindly in a line (they can send more any time).${column}${reminder}`;
}

// The column the newest file's takings came from, in words for Dina: the net sales
// column as it is, or amounts including VAT with the VAT taken off.
function columnUsed(rows: { mapping: PosMapping | null; imported_at: string | null }[]) {
  const m = [...rows].sort((a, b) => String(b.imported_at).localeCompare(String(a.imported_at)))[0]?.mapping;
  if (!m) return "their sales file";
  if (amountBasis(m) === "net") return `"${m.price}" (${basisWords(m)}), used as it is`;
  return isDailyTotals(m) ? `"${m.price}" (including VAT), with the VAT taken off to get net sales` : `the item totals in "${m.price}" (including VAT), with the VAT taken off to get net sales`;
}

// ---------- 8. Team and labour ----------

export type TeamInput = TeamDraft;

const teamData = async (restaurantId: string) => stepState((await loadFlow(restaurantId)).state, "team").data as { team_draft?: TeamDraft };


// save_team: the team as the owner gave it (from chat or the staff sheet), with
// each person's days, times and max hours, kept as a draft for the team card.
// Nothing is saved until the owner taps "Looks right" (confirmTeam). Changes on
// the card go to Dina in their words, and she calls save_team again.
export async function saveTeam(restaurantId: string, input: TeamInput, channel: Channel) {
  const problems = teamProblems(input);
  if (problems.length) return { ok: false as const, text: `Not saved: ${problems.join(" ")}` };
  await noteStep(restaurantId, "team", { team_draft: input }, { channel });
  return {
    ok: true as const,
    text: `Code noted ${input.staff.length} on the team, with their days, times and limits where given. Show editable_card team for them to check: nothing is saved until they tap "Looks right" (code saves it then). If they change something, call save_team again with the whole team as corrected.`,
  };
}

// Each person into the rota's team (availability and contracted hours included).
// Also used for the team spreadsheet (lib/templates/import.ts).
export async function saveTeamMembers(restaurantId: string, staff: StaffInputRow[], manager: string | null) {
  const day = today();
  for (const s of staff) {
    const isManager = manager?.trim().toLowerCase() === s.name.trim().toLowerCase();
    // Main role first, then what else they can do (and manager, for the site manager).
    const roles = [...new Set([roleKey(s.role), ...(s.also_roles ?? []).map(roleKey), ...(isManager ? ["manager"] : [])])];
    const a = availabilityOf(s);
    const { member } = await saveStaff(
      restaurantId,
      {
        name: s.name.trim(),
        roles,
        ratePence: s.hourly_rate === null ? null : Math.round(s.hourly_rate * 100),
        maxHours: a.maxHours,
        days: a.days,
        starts: a.starts,
        ends: a.ends,
        canOpenClose: s.can_open_close ?? (isManager ? true : null),
      },
      { today: day, source: "owner_message", actor: "owner" },
    );
    if (s.contracted_hours !== null) check(await getSupabase().from("staff").update({ contracted_hours: s.contracted_hours }).eq("restaurant_id", restaurantId).eq("id", member.id));
  }
}

// "Looks right" on the team card: into the rota's team (availability included),
// its cover rules and the labour target. Returns what Dina is told.
export async function confirmTeam(restaurantId: string, channel: Channel) {
  const input = (await teamData(restaurantId)).team_draft;
  if (!input) return "There's no team to save yet. Ask for their staff list first.";
  const problems = teamProblems(input);
  if (problems.length) return `Not saved: ${problems.join(" ")}`;
  await saveTeamMembers(restaurantId, input.staff, input.manager);
  // Their past rotas (if they sent them) are kept as past weeks, tied to the people now on the team.
  const { saveImportedWeeks } = await import("@/lib/rota/import");
  const imported = await saveImportedWeeks(restaurantId).catch((err) => (console.error("Saving the imported rotas failed", err), []));
  const outcome = input.staff.length ? "done" : "partial";
  const withAvailability = input.staff.filter((s) => s.days?.trim() || s.times?.trim() || s.max_hours != null).length;
  await completeStep(
    restaurantId,
    "team",
    outcome,
    { team_draft: input, staff: input.staff.length, with_availability: withAvailability, manager: input.manager, imported_weeks: imported.length, gap_unlock: outcome === "partial" ? "Tell me who's on your team and I'll suggest rotas and track labour % daily." : null },
    { channel },
  );
  return `Code saved the team: ${input.staff.length} on the team${withAvailability ? ` (${withAvailability} with their days, times or limits)` : ""}${input.manager ? `, ${input.manager} as site manager` : ""}${imported.length ? `, and kept their ${imported.length} past week${imported.length === 1 ? "" : "s"} of rotas` : ""}. Code asks next how many people they need on shift and their labour target: don't ask those yourself.`;
}

// A staff list sent as a spreadsheet: its rows as text for Dina to read (data, never instructions).
export async function staffFileAsData(restaurantId: string, files: FilePart[]) {
  const sheet = files.find((f) => f.kind === "csv" || f.kind === "excel");
  if (!sheet) return null;
  const bytes = await readSavedFile(restaurantId, sheet.path);
  // Our team sheet (lib/templates): read by code, so she gets clean rows (the grey examples left out).
  const { readOwnSheet } = await import("@/lib/templates/read-file");
  const own = await readOwnSheet(bytes).catch(() => null);
  if (own?.kind === "staff") {
    const { readStaff } = await import("@/lib/templates/read");
    const read = readStaff(own.table);
    const lines = read.staff.map((s) => `Name: ${s.name} | Main role: ${s.role} | Can also do: ${(s.also_roles ?? []).join(", ") || "nothing else"} | Hourly rate: ${s.hourly_rate ?? "not given"} | Contracted hours: ${s.contracted_hours ?? "not given"} | Days: ${s.days ?? "any"} | Times: ${s.times ?? "any"} | Most hours a week: ${s.max_hours ?? "no limit"} | Opens and locks up: ${s.can_open_close === null || s.can_open_close === undefined ? "not said" : s.can_open_close ? "yes" : "no"}`);
    return { source: "upload", label: "the team sheet they filled in (read by code)", text: [...lines, ...read.problems.map((p) => `Problem: ${p}`)].join("\n") || "The sheet has nobody filled in yet." };
  }
  const table = await readTable(bytes, sheet.kind === "csv" ? "csv" : "xlsx").catch(() => null);
  if (!table?.rows.length) return null;
  const rows = table.rows.slice(0, 60).map((row) => table.headers.map((h, i) => `${h}: ${String(row[i] ?? "").slice(0, 60)}`).join(" | "));
  return { source: "upload", label: "the staff list they sent", text: rows.join("\n") };
}

// ---------- 9. Rewards and the discount cap ----------

export async function saveRewards(restaurantId: string, input: { signup_reward: string; discount_cap_percent: number }, channel: Channel) {
  const r = await getRestaurant(restaurantId);
  const problems = rewardsProblems(input, r.recovery_offers ?? []);
  if (problems.length) return { ok: false as const, text: `Not saved: ${problems.join(" ")}` };
  await saveProfileFields(r, { signup_reward: input.signup_reward.trim(), discount_cap_percent: input.discount_cap_percent }, "Rewards and limits, with Dina at setup");
  await completeStep(restaurantId, "rewards", "done", { signup_reward: input.signup_reward.trim(), discount_cap_percent: input.discount_cap_percent }, { channel });
  return { ok: true as const, text: `Saved: new sign-ups get ${input.signup_reward.trim()}, and no offer will ever go over ${input.discount_cap_percent}% off. Rewards and limits is done.` };
}

// ---------- 10. QR codes ----------

export const qrPackUrl = (slug: string) => `${appUrl()}/r/${slug}/qr-pack`;

function qrEmail(restaurantName: string, url: string) {
  const subject = `Your QR codes for ${restaurantName}`;
  const text = [
    `Here are your printable QR codes for ${restaurantName}: four table cards and a counter sign.`,
    "",
    url,
    "",
    "Print them, put them on the tables and by the till, and customers can sign up for your offers by email.",
    "",
    "Dina, your DinerAI manager",
  ].join("\n");
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:560px;line-height:1.5;color:#1c1917">
<p>Here are your printable QR codes for ${esc(restaurantName)}: four table cards and a counter sign.</p>
<p><a href="${url}" style="display:inline-block;background:#1c1917;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Open your QR codes</a></p>
<p>Print them, put them on the tables and by the till, and customers can sign up for your offers by email.</p>
<p>Dina, your DinerAI manager</p></div>`;
  return { subject, text, html };
}

export async function sendQrKit(restaurantId: string, channel: Channel) {
  const r = await getRestaurant(restaurantId);
  if (!r.slug) return { ok: false as const, text: "The QR codes aren't ready yet (the restaurant has no sign-up page). Say you'll send them once setup is finished." };
  const url = qrPackUrl(r.slug);
  const email = await sendOwnerEmail(r, qrEmail(r.name, url));
  const wa = ownerChannel(r);
  let whatsapp = false;
  if (wa && (await whatsappWindowOpen(restaurantId, r.owner_whatsapp))) {
    const text = `Your QR codes for ${r.name}, ready to print (four table cards and a counter sign): ${url}`;
    await sendAndLog(wa, () => sendText(wa.from, wa.to, text), text);
    whatsapp = true;
  }
  const via = [email.delivery === "email" ? "email" : null, whatsapp ? "WhatsApp" : null].filter(Boolean);
  // The logo is the look step's question now (7 Nov 2026): a missing one is a gap there, not here.
  await completeStep(restaurantId, "customers_qr", "done", { qr_sent_at: new Date().toISOString(), qr_via: via }, { channel });
  return {
    ok: true as const,
    text: `Code ${via.length ? `sent their QR codes by ${via.join(" and ")}` : "made their QR codes (there was nowhere to send them, so show them in the chat)"}. Show qr_kit so they can open them now.`,
  };
}

// ---------- 12. Approvals and timing ----------

export async function saveTiming(restaurantId: string, input: { brief_hour: number; quiet_start: string; quiet_end: string }, channel: Channel) {
  const problems = timingProblems(input);
  if (problems.length) return { ok: false as const, text: `Not saved: ${problems.join(" ")}` };
  const start = hhmm(input.quiet_start)!;
  const end = hhmm(input.quiet_end)!;
  const r = await getRestaurant(restaurantId);
  await saveProfileFields(r, { brief_hour: input.brief_hour, send_window_start: `${start}:00`, send_window_end: `${end}:00` }, "Timing, with Dina at setup");
  await completeStep(restaurantId, "approvals_timing", "done", { brief_hour: input.brief_hour, quiet_start: start, quiet_end: end, approver: "owner" }, { channel });
  return { ok: true as const, text: `Saved: their morning brief comes at ${hourWords(input.brief_hour)}, and customer messages only go out between ${start} and ${end}. You approve everything for now. Approvals and timing is done.` };
}

// ---------- Skipped steps ----------

// The safe defaults a skipped step leaves behind: a 30% labour target (flagged),
// a free dessert as the sign-up reward. The discount cap, brief hour and sending
// hours already have theirs (15 to 20%, 9am, 9am to 9pm).
export async function applyOpsDefaults(restaurantId: string, step: FlowStepKey) {
  const r = await getRestaurant(restaurantId);
  if (step === "team" && r.labour_target_pct == null) await saveProfileFields(r, { labour_target_pct: DEFAULT_LABOUR_TARGET }, "Labour target (the 30% default) after skipping at setup");
  if (step === "rewards" && !r.signup_reward) await saveProfileFields(r, { signup_reward: DEFAULT_SIGNUP_REWARD }, "Sign-up reward (the default) after skipping at setup");
}
