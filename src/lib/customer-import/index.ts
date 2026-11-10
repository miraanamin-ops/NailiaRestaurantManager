import "server-only";
import { createHash } from "node:crypto";
import { logAction } from "@/lib/audit";
import { isInSendWindow } from "@/lib/clock";
import { check, createDraft, updateDraft, type Draft } from "@/lib/drafts";
import { getSupabase, type Restaurant } from "@/lib/supabase";
import {
  basisQuestion,
  cleanRows,
  consentWording,
  declarationQuestion,
  declarationText,
  MAX_IMPORT_ROWS,
  previewLines,
  sendRoom,
  shouldPause,
  UNKNOWN_BASIS_REPLY,
  welcomeReason,
  type Basis,
  type ImportRow,
  type Mapping,
  type Table,
} from "./rules";
import { suppress, suppressedHashes } from "./suppression";

// Importing a customer list (064): preview, basis and declaration, the welcome email
// the owner approves, daily batches, bounces, and removing a whole import. The rules
// are in rules.ts; the web pages are /customers/import/*, WhatsApp goes through
// lib/agents/gm-open.ts.

export type CustomerImport = {
  id: string;
  restaurant_id: string;
  created_at: string;
  channel: "web" | "whatsapp";
  created_by: string | null;
  file_name: string | null;
  file_hash: string;
  mapping: Mapping;
  mapped_by: "ai" | "rules";
  rows_total: number;
  rows_invalid: number;
  rows_duplicate: number;
  rows_existing: number;
  rows_suppressed: number;
  rows_to_add: number;
  preview_rows: ImportRow[] | null;
  basis: "opted_in" | "past_customers" | null;
  declaration: string | null;
  declared_by: string | null;
  declared_at: string | null;
  double_opt_in: boolean;
  status: "preview" | "imported" | "sending" | "done" | "cancelled" | "paused" | "undone";
  welcome_draft_id: string | null;
  approved_at: string | null;
  paused_reason: string | null;
  undone_at: string | null;
  rows_added: number;
};

const ok = <T>(res: { data: T; error: { message: string } | null }) => check(res);

export async function getImport(restaurantId: string, importId: string) {
  return ok(await getSupabase().from("customer_imports").select("*").eq("restaurant_id", restaurantId).eq("id", importId).maybeSingle<CustomerImport>());
}

// The latest import still in preview (waiting for the owner's answer on WhatsApp).
export async function pendingPreview(restaurantId: string) {
  return ok(
    await getSupabase().from("customer_imports").select("*").eq("restaurant_id", restaurantId).eq("status", "preview").order("created_at", { ascending: false }).limit(1).maybeSingle<CustomerImport>(),
  );
}

const fieldsFound = (m: Mapping) => ["email", m.name !== null ? "name" : "", m.phone !== null ? "phone" : "", m.birthday !== null ? "birthday" : ""].filter(Boolean);

// ---------- 1. The preview ----------

export type PreviewResult = { ok: true; imp: CustomerImport; lines: string[] } | { ok: false; text: string };

export async function previewImport(input: { restaurantId: string; table: Table; bytes: Buffer; fileName: string | null; channel: "web" | "whatsapp"; createdBy: string | null }): Promise<PreviewResult> {
  const { restaurantId, table } = input;
  if (!table.rows.length) return { ok: false, text: "That file has no rows in it. Could you send it again?" };
  if (table.rows.length > MAX_IMPORT_ROWS) return { ok: false, text: `That file has ${table.rows.length.toLocaleString("en-GB")} rows: during the pilot an import can have up to ${MAX_IMPORT_ROWS.toLocaleString("en-GB")}. Could you split it into smaller files?` };
  const { mapColumns } = await import("./ai");
  const { mapping, by } = await mapColumns(table);
  if (mapping.email === null) return { ok: false, text: "I couldn't find a column of email addresses in that file. Could you send a CSV or Excel file with the customers' emails in one column?" };

  const supabase = getSupabase();
  const existing = new Set(
    (ok(await supabase.from("customers").select("email").eq("restaurant_id", restaurantId).not("email", "is", null).limit(100_000).returns<{ email: string }[]>()) ?? []).map((c) => c.email.trim().toLowerCase()),
  );
  const cleaned = cleanRows(table, mapping, existing, await suppressedHashes(restaurantId));

  // A new file replaces a preview still waiting.
  ok(await supabase.from("customer_imports").update({ status: "cancelled", preview_rows: null }).eq("restaurant_id", restaurantId).eq("status", "preview"));
  const imp = ok(
    await supabase
      .from("customer_imports")
      .insert({
        restaurant_id: restaurantId,
        channel: input.channel,
        created_by: input.createdBy,
        file_name: input.fileName,
        file_hash: createHash("sha256").update(input.bytes).digest("hex"),
        mapping,
        mapped_by: by,
        rows_total: cleaned.counts.total,
        rows_invalid: cleaned.counts.invalid,
        rows_duplicate: cleaned.counts.duplicate,
        rows_existing: cleaned.counts.existing,
        rows_suppressed: cleaned.counts.suppressed,
        rows_to_add: cleaned.counts.to_add,
        preview_rows: cleaned.rows,
        status: cleaned.rows.length ? "preview" : "cancelled",
      })
      .select("*")
      .single<CustomerImport>(),
  )!;
  const lines = previewLines(cleaned.counts, fieldsFound(mapping));
  if (!cleaned.rows.length) return { ok: false, text: `${lines.join("\n")}\nThere's nobody new to add from that file.` };
  return { ok: true, imp, lines };
}

// WhatsApp: the preview and the basis question in one message.
export function previewMessage(p: Extract<PreviewResult, { ok: true }>) {
  return [...p.lines, "", basisQuestion()].join("\n");
}

export async function cancelPreview(restaurantId: string, importId: string) {
  ok(await getSupabase().from("customer_imports").update({ status: "cancelled", preview_rows: null }).eq("restaurant_id", restaurantId).eq("id", importId).eq("status", "preview"));
}

// ---------- 2. How they agreed (WhatsApp: asked in two steps) ----------

export async function chooseBasis(r: Restaurant, imp: CustomerImport, basis: Basis) {
  if (basis === "unknown") {
    await cancelPreview(r.id, imp.id);
    return { accepted: false as const, text: UNKNOWN_BASIS_REPLY };
  }
  ok(await getSupabase().from("customer_imports").update({ basis }).eq("restaurant_id", r.id).eq("id", imp.id));
  return { accepted: true as const, text: declarationQuestion(basis, r.name, imp.rows_to_add) };
}

// ---------- 3. Confirmed: the contacts are added, the welcome waits for approval ----------

export type ConfirmResult = { ok: true; added: number; draft: Draft } | { ok: false; text: string };

export async function confirmImport(input: { restaurant: Restaurant; importId: string; basis: Basis; declaredBy: string; doubleOptIn: boolean; declaration?: string }): Promise<ConfirmResult> {
  const r = input.restaurant;
  if (input.basis === "unknown") {
    await cancelPreview(r.id, input.importId);
    return { ok: false, text: UNKNOWN_BASIS_REPLY };
  }
  const basis = input.basis;
  const imp = await getImport(r.id, input.importId);
  if (!imp || imp.status !== "preview" || !imp.preview_rows?.length) return { ok: false, text: "That import isn't waiting any more. Send or upload the file again whenever you're ready." };

  const supabase = getSupabase();
  const now = new Date().toISOString();
  // Exactly what the owner confirmed (the web's tick box, or WhatsApp's declaration), with the basis they chose.
  const declaration = input.declaration ? `${input.declaration} (Basis chosen: ${basis === "opted_in" ? "they opted in to marketing" : "past customers given a chance to opt out"}.)` : declarationText(basis, r.name, imp.rows_to_add);
  const { newToken } = await import("@/lib/signups");
  // Anyone added to the list since the preview isn't added twice.
  const have = new Set(
    (ok(await supabase.from("customers").select("email").eq("restaurant_id", r.id).in("email", imp.preview_rows.map((x) => x.email)).returns<{ email: string }[]>()) ?? []).map((c) => c.email),
  );
  const rows = imp.preview_rows.filter((x) => !have.has(x.email));
  let added = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const inserted =
      ok(
        await supabase
          .from("customers")
          .insert(
            batch.map((x) => ({
              restaurant_id: r.id,
              name: x.name ?? "",
              email: x.email,
              phone: x.phone,
              birthday: x.birthday,
              source: "import",
              consent_basis: basis,
              // With double opt-in, marketing starts only once they confirm (like a sign-up).
              marketing_opt_in: !input.doubleOptIn,
              unsubscribe_token: newToken(),
              confirm_token: input.doubleOptIn ? newToken() : null,
              visit_count: 0,
              import_id: imp.id,
              import_basis: basis,
              import_declared_by: input.declaredBy,
              import_declared_at: now,
              import_file_hash: imp.file_hash,
              import_status: input.doubleOptIn ? "awaiting_confirm" : "not_contacted",
            })),
          )
          .select("id, email")
          .returns<{ id: string; email: string }[]>(),
      ) ?? [];
    if (inserted.length) {
      ok(
        await supabase.from("consents").insert(
          inserted.map((c) => ({ restaurant_id: r.id, customer_id: c.id, email: c.email, granted: true, wording: consentWording(basis, r.name), form_version: "import-2", privacy_version: null, source: "import", confirmed_at: input.doubleOptIn ? null : now })),
        ),
      );
    }
    added += inserted.length;
  }

  const content = welcomeDraftText(r, basis, added, input.doubleOptIn);
  const draft = await createDraft({
    restaurantId: r.id,
    kind: "import_welcome",
    content,
    audience: `${added.toLocaleString("en-GB")} imported customer${added === 1 ? "" : "s"}`,
    request: `Import of ${imp.file_name ?? "a customer list"}`,
    checks: {},
    mode: "present",
    actor: "owner",
    agentInput: { import_id: imp.id },
  });
  ok(
    await supabase
      .from("customer_imports")
      .update({ status: "imported", basis, declaration, declared_by: input.declaredBy, declared_at: now, double_opt_in: input.doubleOptIn, rows_added: added, preview_rows: null, welcome_draft_id: draft.id })
      .eq("restaurant_id", r.id)
      .eq("id", imp.id),
  );
  await logAction({
    restaurantId: r.id,
    actor: "owner",
    action: "customers_imported",
    detail: `Imported ${added} customers from ${imp.file_name ?? "a file"} (${basis === "opted_in" ? "they opted in" : "past customers given a chance to opt out"}; declared by ${input.declaredBy})`,
    data: { import_id: imp.id, added, basis, file_hash: imp.file_hash, declaration },
  });
  return { ok: true, added, draft };
}

// What the owner approves: what goes out, to whom, and how.
export function welcomeDraftText(r: Pick<Restaurant, "name" | "signup_reward">, basis: "opted_in" | "past_customers", count: number, doubleOptIn: boolean) {
  const n = count.toLocaleString("en-GB");
  if (doubleOptIn) {
    return [
      `*Confirm-your-email message to ${n} imported customers*`,
      `Each gets "Confirm your email for ${r.name}": one tap to confirm, then your sign-up reward${r.signup_reward ? ` (${r.signup_reward})` : ""}. Only those who confirm are added to your offers.`,
      "Sent in batches of up to 50 a day, within your sending hours.",
    ].join("\n");
  }
  return [
    `*Welcome email to ${n} imported customers*`,
    `"You're on ${r.name}'s email list because ${welcomeReason(basis, r.name)}. From now on we'll send you the occasional offer and news, never more than one offer a week. Rather not hear from us? Tap Unsubscribe."`,
    r.signup_reward ? `It includes your sign-up reward (${r.signup_reward}) to show at the till.` : "Tip: set a sign-up reward first (e.g. \"set sign-up reward to a free drink\") and it goes in the welcome.",
    "Sent in batches of up to 50 a day, within your sending hours. No offer reaches them until their welcome has gone.",
  ].join("\n");
}

// ---------- 4. The welcome approved, skipped ----------

const importOf = (d: Draft) => (d as Draft & { agent_input?: { import_id?: string } }).agent_input?.import_id ?? null;

export async function approveImportWelcome(r: Restaurant, draft: Draft) {
  const id = importOf(draft);
  const imp = id ? await getImport(r.id, id) : null;
  if (!imp || imp.status !== "imported") return "That import isn't waiting for approval any more.";
  const now = new Date().toISOString();
  await updateDraft(draft.id, { status: "approved", approved_at: now, waiting_for: null });
  ok(await getSupabase().from("customer_imports").update({ status: "sending", approved_at: now }).eq("restaurant_id", r.id).eq("id", imp.id));
  await logAction({ restaurantId: r.id, draftId: draft.id, actor: "owner", action: "approved", detail: `Approved the welcome email for ${imp.rows_added} imported customers` });
  return `👍 Approved. ${imp.double_opt_in ? "The confirm-your-email messages" : "The welcome emails"} go out in batches of up to 50 a day, within your sending hours. I'll let you know if anything looks wrong.`;
}

export async function skipImportWelcome(r: Restaurant, draft: Draft) {
  await updateDraft(draft.id, { status: "skipped", waiting_for: null });
  await logAction({ restaurantId: r.id, draftId: draft.id, actor: "owner", action: "skipped", detail: "Skipped the welcome email for an imported list (nobody on it is emailed)" });
  return "👍 Skipped: nobody on that list will be emailed. To remove the list, send *UNDO* or go to *Customers*, then *Imports*.";
}

// ---------- 5. Sending, hourly ----------

type DueCustomer = { id: string; name: string; email: string; unsubscribe_token: string | null; confirm_token: string | null; import_id: string; import_basis: "opted_in" | "past_customers"; import_status: string; source: string };

export async function runImportWelcomes(r: Restaurant, now: Date) {
  const supabase = getSupabase();
  const sending = ok(await supabase.from("customer_imports").select("*").eq("restaurant_id", r.id).eq("status", "sending").returns<CustomerImport[]>()) ?? [];
  if (!sending.length) return { sent: 0 };
  if (r.paused || !isInSendWindow(now, r.send_window_start, r.send_window_end)) return { sent: 0, skipped: "outside sending hours or paused" };

  // Too many bounces: pause before sending more.
  const live: CustomerImport[] = [];
  for (const imp of sending) if (!(await pauseIfBouncing(r, imp))) live.push(imp);
  if (!live.length) return { sent: 0 };

  const { count } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).gte("welcome_sent_at", new Date(now.getTime() - 24 * 3_600_000).toISOString());
  const due =
    ok(
      await supabase
        .from("customers")
        .select("id, name, email, unsubscribe_token, confirm_token, import_id, import_basis, import_status, source")
        .eq("restaurant_id", r.id)
        .in("import_id", live.map((i) => i.id))
        .is("welcome_sent_at", null)
        .is("unsubscribed_at", null)
        .is("deleted_at", null)
        .is("bounced_at", null)
        .order("created_at")
        .limit(100)
        .returns<DueCustomer[]>(),
    ) ?? [];
  const room = sendRoom(count ?? 0, due.length);
  const [{ sendImportWelcomeEmail, sendConfirmEmail }, { appUrl }] = await Promise.all([import("@/lib/email"), import("@/lib/supabase")]);
  let sent = 0;
  for (const c of due.slice(0, room)) {
    const imp = live.find((i) => i.id === c.import_id)!;
    try {
      let delivery: { id: string | null };
      if (imp.double_opt_in && c.confirm_token) {
        delivery = await sendConfirmEmail({ restaurant: r, customer: { ...c, confirm_token: c.confirm_token }, baseUrl: appUrl() });
      } else {
        const reward = r.signup_reward ? await rewardFor(r, c.id) : null;
        delivery = await sendImportWelcomeEmail({ restaurant: r, customer: c, reason: welcomeReason(c.import_basis, r.name), reward, baseUrl: appUrl() });
      }
      const at = new Date().toISOString();
      ok(
        await supabase
          .from("customers")
          .update({ welcome_sent_at: at, welcome_email_id: delivery.id, ...(imp.double_opt_in ? { confirm_sent_at: at } : { import_status: "welcomed" }) })
          .eq("restaurant_id", r.id)
          .eq("id", c.id),
      );
      sent++;
    } catch (err) {
      console.error("An imported customer's welcome email failed", err);
    }
  }
  // An import whose contacts have all been sent to is done.
  for (const imp of live) {
    const { count: left } = await supabase.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", r.id).eq("import_id", imp.id).is("welcome_sent_at", null).is("unsubscribed_at", null).is("deleted_at", null).is("bounced_at", null);
    if (!left) ok(await supabase.from("customer_imports").update({ status: "done" }).eq("restaurant_id", r.id).eq("id", imp.id).eq("status", "sending"));
  }
  return { sent };
}

async function rewardFor(r: Restaurant, customerId: string) {
  const supabase = getSupabase();
  const have = ok(await supabase.from("rewards").select("token, reward").eq("restaurant_id", r.id).eq("customer_id", customerId).maybeSingle<{ token: string; reward: string }>());
  if (have) return have;
  const { newToken } = await import("@/lib/signups");
  return ok(await supabase.from("rewards").insert({ restaurant_id: r.id, customer_id: customerId, token: newToken(), reward: r.signup_reward ?? "a little welcome treat" }).select("token, reward").single<{ token: string; reward: string }>());
}

// ---------- 6. Bounces ----------

export async function importStats(restaurantId: string, importId: string) {
  const supabase = getSupabase();
  const q = () => supabase.from("customers").select("id", { count: "exact", head: true }).eq("restaurant_id", restaurantId).eq("import_id", importId);
  const [sent, bounced, unsubscribed] = await Promise.all([q().not("welcome_sent_at", "is", null), q().not("bounced_at", "is", null), q().not("unsubscribed_at", "is", null)]);
  return { sent: sent.count ?? 0, bounced: bounced.count ?? 0, unsubscribed: unsubscribed.count ?? 0 };
}

// Over the bounce limit: the import's sending pauses, the builder is alerted, and the owner told the list looks out of date.
export async function pauseIfBouncing(r: Restaurant, imp: CustomerImport) {
  if (imp.status !== "sending") return imp.status === "paused";
  const s = await importStats(r.id, imp.id);
  if (!shouldPause(s.sent, s.bounced)) return false;
  const reason = `${s.bounced} of ${s.sent} welcome emails bounced`;
  ok(await getSupabase().from("customer_imports").update({ status: "paused", paused_reason: reason }).eq("restaurant_id", r.id).eq("id", imp.id));
  await logAction({ restaurantId: r.id, actor: "system", action: "blocked", detail: `Paused sending to an imported list: ${reason}`, data: { import_id: imp.id, ...s } });
  const { alertBuilder } = await import("@/lib/builder-alerts");
  await alertBuilder(`import-bounces:${imp.id}`, `${r.name}: paused sending to an imported customer list (${imp.file_name ?? imp.id}): ${reason} (over 5%). Check the list before resuming.`).catch(() => "");
  const [{ ownerChannel }, { messageOwner }] = await Promise.all([import("@/lib/followups"), import("@/lib/notify")]);
  const channel = ownerChannel(r);
  if (channel)
    await messageOwner(channel, `⚠️ Quite a few emails to the customer list you imported bounced (${reason}), so I've paused sending to it to protect your emails. The list looks out of date. Nothing else is affected. To remove it, send *UNDO* or go to *Customers*, then *Imports*.`, false, { opener: "update" }).catch(() => null);
  return true;
}

// A hard bounce (the Resend webhook): never emailed again, and the import it came from checked.
export async function recordHardBounce(address: string, emailId: string | null) {
  await suppress(null, address, "hard_bounce");
  const supabase = getSupabase();
  const byId = emailId ? (ok(await supabase.from("customers").select("id, restaurant_id, import_id").eq("welcome_email_id", emailId).returns<{ id: string; restaurant_id: string; import_id: string | null }[]>()) ?? []) : [];
  const byAddress = ok(await supabase.from("customers").select("id, restaurant_id, import_id").eq("email", address.trim().toLowerCase()).returns<{ id: string; restaurant_id: string; import_id: string | null }[]>()) ?? [];
  const hit = [...new Map([...byId, ...byAddress].map((c) => [c.id, c])).values()];
  const at = new Date().toISOString();
  for (const c of hit) ok(await supabase.from("customers").update({ bounced_at: at }).eq("restaurant_id", c.restaurant_id).eq("id", c.id));
  for (const c of hit.filter((x) => x.import_id)) {
    const [r, imp] = await Promise.all([
      supabase.from("restaurants").select("*").eq("id", c.restaurant_id).maybeSingle<Restaurant>().then(check),
      getImport(c.restaurant_id, c.import_id!),
    ]);
    if (r && imp) await pauseIfBouncing(r, imp);
  }
  return hit.length;
}

// ---------- 7. Removing a whole import ----------

export async function removeImport(restaurantId: string, importId: string, actor: "owner" | "builder" = "owner") {
  const imp = await getImport(restaurantId, importId);
  if (!imp) return { ok: false as const, text: "I couldn't find that import." };
  if (imp.status === "undone") return { ok: false as const, text: "That import has already been removed." };
  const supabase = getSupabase();
  const ids = (ok(await supabase.from("customers").select("id").eq("restaurant_id", restaurantId).eq("import_id", importId).returns<{ id: string }[]>()) ?? []).map((c) => c.id);
  for (let i = 0; i < ids.length; i += 200) {
    const batch = ids.slice(i, i + 200);
    ok(await supabase.from("consents").delete().eq("restaurant_id", restaurantId).in("customer_id", batch));
    ok(await supabase.from("customers").delete().eq("restaurant_id", restaurantId).in("id", batch));
  }
  ok(await supabase.from("customer_imports").update({ status: "undone", undone_at: new Date().toISOString(), preview_rows: null }).eq("restaurant_id", restaurantId).eq("id", importId));
  if (imp.welcome_draft_id) ok(await supabase.from("drafts").update({ status: "withdrawn", waiting_for: null }).eq("restaurant_id", restaurantId).eq("id", imp.welcome_draft_id).eq("status", "pending"));
  await logAction({ restaurantId, actor, action: "import_removed", detail: `Removed an imported customer list (${ids.length} customers, ${imp.file_name ?? "a file"})`, data: { import_id: importId, removed: ids.length } });
  return { ok: true as const, removed: ids.length, text: `🗑️ Removed that import: ${ids.length.toLocaleString("en-GB")} customer${ids.length === 1 ? "" : "s"} taken off your list. Anyone who unsubscribed stays off it.` };
}

// ---------- 8. History ----------

export async function importHistory(restaurantId: string) {
  const imports =
    ok(
      await getSupabase()
        .from("customer_imports")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .in("status", ["imported", "sending", "done", "paused", "undone"])
        .order("created_at", { ascending: false })
        .limit(50)
        .returns<CustomerImport[]>(),
    ) ?? [];
  return Promise.all(imports.map(async (imp) => ({ ...imp, preview_rows: null, ...(await importStats(restaurantId, imp.id)) })));
}

// ---------- 9. The admin console (builder only) ----------

export async function importsForAdmin() {
  const supabase = getSupabase();
  const [imports, names] = await Promise.all([
    supabase.from("customer_imports").select("id, restaurant_id, created_at, file_name, status, basis, rows_added, rows_to_add, paused_reason").neq("status", "preview").order("created_at", { ascending: false }).limit(20).returns<Pick<CustomerImport, "id" | "restaurant_id" | "created_at" | "file_name" | "status" | "basis" | "rows_added" | "rows_to_add" | "paused_reason">[]>(),
    supabase.from("restaurants").select("id, name").returns<{ id: string; name: string }[]>(),
  ]);
  if (imports.error) throw new Error(imports.error.message);
  const nameOf = new Map((names.data ?? []).map((r) => [r.id, r.name]));
  return Promise.all(
    (imports.data ?? []).map(async (imp) => {
      const s = await importStats(imp.restaurant_id, imp.id);
      return { ...imp, ...s, restaurant: nameOf.get(imp.restaurant_id) ?? "?", bounce_rate: s.sent ? Math.round((s.bounced / s.sent) * 1000) / 10 : 0 };
    }),
  );
}
