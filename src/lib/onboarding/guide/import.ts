import "server-only";
import { logAction } from "@/lib/audit";
import { check } from "@/lib/drafts";
import { isInSendWindow } from "@/lib/clock";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import { stepState } from "../flow";
import { loadFlow, patchStepData } from "../sessions";
import { readSavedFile, type FilePart } from "../dina/uploads-store";
import { customersFromTable, type ImportRow } from "./import-rules";

// An existing customer list at setup (owner's plan, 7 Nov 2026). The file is read
// into a draft; the owner says how those customers agreed to marketing; only if
// they agreed are they added, each unconfirmed (no marketing) until they confirm
// by email like anyone who signs up. Confirm emails go out hourly within the
// sending hours, at most CONFIRMS_PER_DAY a day per restaurant (Resend's free
// plan, and a gentle start). Rules in import-rules.ts (unit-tested).

export const CONFIRMS_PER_DAY = 50;
const MAX_ROWS = 5000;
export const IMPORT_WORDING = "Added by the restaurant at setup: the owner said these customers signed up for its offers or newsletter. Marketing starts only once each confirms by email.";

// The file they sent: its customers, kept on the step as a draft.
export async function readCustomerFile(restaurantId: string, file: FilePart) {
  const { readTable } = await import("@/lib/sales/pos-file");
  const bytes = await readSavedFile(restaurantId, file.path);
  const table = await readTable(bytes, file.kind === "excel" ? "xlsx" : "csv").catch(() => null);
  const read = table ? customersFromTable(table, MAX_ROWS) : null;
  if (!read || !read.rows.length) return { ok: false as const, text: read?.problem ?? "I couldn't find any email addresses in that file. Could you send a CSV or Excel file with a column of emails?" };
  await patchStepData(restaurantId, "customers_qr", { import_draft: { rows: read.rows, count: read.rows.length, skipped: read.skipped } });
  return { ok: true as const, count: read.rows.length, skipped: read.skipped };
}

export async function dropImport(restaurantId: string) {
  await patchStepData(restaurantId, "customers_qr", { import_draft: null });
}

// "They signed up": each new email added (unconfirmed), with the owner's word on
// how they agreed kept as their consent record.
export async function importCustomers(restaurantId: string) {
  const { state } = await loadFlow(restaurantId);
  const draft = stepState(state, "customers_qr").data.import_draft as { rows?: ImportRow[] } | null | undefined;
  const rows = draft?.rows ?? [];
  const supabase = getSupabase();
  const { newToken } = await import("@/lib/signups");
  const have = new Set(
    (check(await supabase.from("customers").select("email").eq("restaurant_id", restaurantId).in("email", rows.map((r) => r.email)).returns<{ email: string }[]>()) ?? []).map((c) => c.email),
  );
  const fresh = rows.filter((r) => !have.has(r.email));
  let added = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const batch = fresh.slice(i, i + 200);
    const inserted =
      check(
        await supabase
          .from("customers")
          .insert(batch.map((r) => ({ restaurant_id: restaurantId, name: r.name, email: r.email, birthday: r.birthday, marketing_opt_in: false, source: "import", consent_basis: "signed_up", unsubscribe_token: newToken(), confirm_token: newToken(), visit_count: 0 })))
          .select("id, email")
          .returns<{ id: string; email: string }[]>(),
      ) ?? [];
    if (inserted.length)
      check(await supabase.from("consents").insert(inserted.map((c) => ({ restaurant_id: restaurantId, customer_id: c.id, email: c.email, granted: true, wording: IMPORT_WORDING, form_version: "import-1", privacy_version: null, source: "import" }))));
    added += inserted.length;
  }
  await patchStepData(restaurantId, "customers_qr", { import_draft: null, imported: added });
  await logAction({ restaurantId, actor: "owner", action: "setting", detail: `Imported ${added} customers at setup (each asked to confirm by email before any marketing)` });
  return { added, existing: rows.length - fresh.length };
}

// Hourly (with the feedback emails): confirm emails for imported customers, within
// the sending hours, never while paused, at most CONFIRMS_PER_DAY a day.
export async function runImportConfirms(restaurant: Restaurant, now: Date) {
  if (restaurant.paused || !isInSendWindow(now, restaurant.send_window_start, restaurant.send_window_end)) return { sent: 0, skipped: "outside sending hours" };
  const supabase = getSupabase();
  const dayStart = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { count } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurant.id).eq("source", "import").gte("confirm_sent_at", dayStart);
  const room = CONFIRMS_PER_DAY - (count ?? 0);
  if (room <= 0) return { sent: 0, skipped: "today's confirm emails have gone" };
  const due =
    check(
      await supabase
        .from("customers")
        .select("*")
        .eq("restaurant_id", restaurant.id)
        .eq("source", "import")
        .is("confirm_sent_at", null)
        .is("email_confirmed_at", null)
        .is("unsubscribed_at", null)
        .is("deleted_at", null)
        .order("created_at")
        .limit(Math.min(room, 10)),
    ) ?? [];
  const [{ sendConfirmEmail }, { markConfirmSent }, { appUrl }] = await Promise.all([import("@/lib/email"), import("@/lib/signups"), import("@/lib/supabase")]);
  let sent = 0;
  for (const c of due as Parameters<typeof markConfirmSent>[0][]) {
    try {
      await sendConfirmEmail({ restaurant, customer: c as never, baseUrl: appUrl() });
      await markConfirmSent(c);
      sent++;
    } catch (err) {
      console.error("An imported customer's confirm email failed", err);
    }
  }
  return { sent };
}
