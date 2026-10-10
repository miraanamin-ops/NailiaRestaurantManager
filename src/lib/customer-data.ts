import "server-only";
import { logAction } from "@/lib/audit";
import { anonymisedCustomer, customersCsv, type ExportCustomer } from "@/lib/customer-csv";
import { check } from "@/lib/drafts";
import { logEvent, type SignupCustomer } from "@/lib/signups";
import { getSupabase } from "@/lib/supabase";

// Customers' data rights: "delete my data" (from every email's footer) and the
// owner's export of their own customer list. Both are written to the audit log.

// Removes a customer's personal details everywhere we keep them, but keeps the
// anonymous rows so the owner's reports still add up.
export async function deleteCustomerData(customer: SignupCustomer, source: string) {
  if (customer.deleted_at) return;
  const supabase = getSupabase();
  const rid = customer.restaurant_id;
  const now = new Date();

  check(
    await supabase
      .from("customers")
      .update({ ...anonymisedCustomer(now), unsubscribed_at: customer.unsubscribed_at ?? now.toISOString() })
      .eq("restaurant_id", rid)
      .eq("id", customer.id),
  );
  // Consent records and email sends keep their dates and outcomes, without the address.
  check(await supabase.from("consents").update({ email: "deleted", user_agent: null }).eq("restaurant_id", rid).eq("customer_id", customer.id));
  check(await supabase.from("campaign_sends").update({ email: "deleted", error: null }).eq("restaurant_id", rid).eq("customer_id", customer.id));
  // Unused rewards stop working (used ones stay, as anonymous counts).
  check(await supabase.from("rewards").delete().eq("restaurant_id", rid).eq("customer_id", customer.id).is("redeemed_at", null));
  check(await supabase.from("customer_events").update({ detail: null }).eq("restaurant_id", rid).eq("customer_id", customer.id));
  check(await supabase.from("feedback").update({ comment: null }).eq("restaurant_id", rid).eq("customer_id", customer.id));
  check(
    await supabase
      .from("feedback_requests")
      .update({ status: "skipped", detail: "customer deleted their data" })
      .eq("restaurant_id", rid)
      .eq("customer_id", customer.id)
      .eq("status", "pending"),
  );

  // WhatsApp notifications to the owner mention the customer ("Aisha (aisha@…) used…").
  if (customer.email) {
    const mentions =
      check(
        await supabase
          .from("messages")
          .select("id, body")
          .eq("restaurant_id", rid)
          .ilike("body", `%${customer.email.replace(/[%_]/g, "")}%`)
          .returns<{ id: string; body: string }[]>(),
      ) ?? [];
    for (const m of mentions) {
      const body = m.body.replaceAll(`${customer.name} (${customer.email})`, "[deleted customer]").replaceAll(customer.email, "[deleted]");
      check(await supabase.from("messages").update({ body }).eq("restaurant_id", rid).eq("id", m.id));
    }
  }

  await logEvent(rid, customer.id, "data_deleted", source);
  await logAction({
    restaurantId: rid,
    actor: "customer",
    action: "data_deleted",
    detail: "A customer deleted their data: name, email, birthday and notes removed (anonymous counts kept for reports)",
    data: { customer_id: customer.id, source },
  });
}

export async function exportCustomers(restaurantId: string) {
  const supabase = getSupabase();
  const customers =
    check(
      await supabase
        .from("customers")
        .select("id, name, email, phone, birthday, source, created_at, email_confirmed_at, marketing_opt_in, unsubscribed_at, visit_count, last_visit")
        .eq("restaurant_id", restaurantId)
        .is("deleted_at", null)
        .order("created_at")
        .returns<(Omit<ExportCustomer, "reward_redeemed_at"> & { id: string })[]>(),
    ) ?? [];
  const rewards =
    check(
      await supabase
        .from("rewards")
        .select("customer_id, redeemed_at")
        .eq("restaurant_id", restaurantId)
        .not("redeemed_at", "is", null)
        .returns<{ customer_id: string; redeemed_at: string }[]>(),
    ) ?? [];
  const redeemed = new Map(rewards.map((r) => [r.customer_id, r.redeemed_at]));
  const rows: ExportCustomer[] = customers.map(({ id, ...c }) => ({ ...c, reward_redeemed_at: redeemed.get(id) ?? null }));
  return { csv: customersCsv(rows), count: rows.length };
}

export async function logExport(restaurantId: string, via: string, count: number) {
  await logAction({
    restaurantId,
    actor: "owner",
    action: "exported",
    detail: `Downloaded the customer list (${count} customer${count === 1 ? "" : "s"}) ${via}`,
    data: { via, count },
  });
}

export function exportFilename(slug: string | null) {
  return `${slug ?? "customers"}-customers-${new Date().toISOString().slice(0, 10)}.csv`;
}
