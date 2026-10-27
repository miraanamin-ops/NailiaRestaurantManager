import "server-only";
import { londonYmd } from "@/lib/clock";
import { focusDraft, getDraft } from "@/lib/drafts";
import { draftMessage } from "@/lib/format";
import { db, must } from "@/lib/ops/db";
import { nextWeekStart, rotaUrl, suggestRota, type RotaWeek } from "@/lib/rota/build";
import { weekLabel } from "@/lib/rota/message";
import { memberLine, removeStaff, saveStaff, team } from "@/lib/rota/staff";
import { findStaff } from "@/lib/rota/edits";
import type { StaffCommand } from "@/lib/rota/staff-input";
import { appUrl } from "@/lib/supabase";
import type { Turn } from "./turn";

// RUN ROTA, ROTA, and the rota team by message (TEAM, "add Ali, kitchen, £13,
// weekdays", "remove Ali from the team"). The rota itself is lib/rota/.

// RUN ROTA (test tools): next week's rota now, from scratch.
export async function runRotaCommand(turn: Turn) {
  await turn.send("🗓️ Working out next week's rota…");
  await suggestRota(turn.ctx.restaurant, { now: turn.ctx.now, send: turn.send, mode: "present", actor: "owner", rebuild: true });
}

// ROTA: where next week's rota is up to.
export async function rotaCommand(turn: Turn) {
  const r = turn.ctx.restaurant;
  const weekStart = nextWeekStart(londonYmd(turn.ctx.now));
  const week = must(await db().from("rota_weeks").select("*").eq("restaurant_id", r.id).eq("week_start", weekStart).maybeSingle(), "rota week") as RotaWeek | null;
  if (week?.status === "published" && week.share_token) {
    return turn.send(`🗓️ Next week's rota (${weekLabel(weekStart)}) is approved.\n🔗 ${rotaUrl(week.share_token)}\n📄 PDF: ${rotaUrl(week.share_token)}/pdf`);
  }
  if (week?.draft_id) {
    const draft = await getDraft(week.draft_id);
    if (draft.status === "pending" && draft.restaurant_id === r.id) {
      return turn.send(draftMessage(await focusDraft(draft, "decision"), r), true);
    }
  }
  return turn.send(`🗓️ I'll suggest next week's rota (${weekLabel(weekStart)}) on Thursday at 10am. Your team: ${appUrl()}/staff?r=${r.id} (or text *TEAM*).`);
}

export async function staffCommand(turn: Turn, cmd: StaffCommand) {
  const r = turn.ctx.restaurant;
  const today = londonYmd(turn.ctx.now);
  if (cmd.name === "team") {
    const members = await team(r.id, today);
    if (!members.length) return turn.send(`👥 Nobody on the rota team yet. Add people like this: *add Ali, kitchen, £13, weekdays*\nOr on the staff page: ${appUrl()}/staff?r=${r.id}`);
    return turn.send(`👥 *Your rota team*\n${members.map(memberLine).join("\n")}\n\nChange anyone by adding them again (e.g. *add Ali, kitchen, £14*), or on the staff page: ${appUrl()}/staff?r=${r.id}`);
  }
  if (cmd.name === "staff_unclear") {
    return turn.send(
      `I couldn't read *${cmd.unread.join("*, *")}* for ${cmd.name_given}, so nothing was saved. Try it like this:\n*add ${cmd.name_given}, kitchen, £13, weekdays*\nDays: _weekdays_, _weekends_, _every day_, _Mon-Thu_, _Fri, Sat_. Times (optional): _5pm-11pm_, _evenings_. Limit (optional): _max 30 hours_.`,
    );
  }
  if (cmd.name === "remove_rota_staff") {
    const members = await team(r.id, today);
    const who = findStaff(members, cmd.who);
    if (!who) return turn.send(`I can't find *${cmd.who}* on your team. Text *TEAM* to see who's on it.`);
    await removeStaff(r.id, who.id, { today, actor: "owner" });
    return turn.send(`👋 *${who.name}* is off the rota team from today. (Past rotas still show their shifts.)`);
  }
  const { member, created } = await saveStaff(r.id, cmd.input, { today, source: "owner_message", actor: "owner" });
  return turn.send(`${created ? "✅ Added to your rota team" : "✅ Updated"}:\n${memberLine(member)}\n\nThey'll be on the next rota I suggest. Text *TEAM* to see everyone.`);
}
