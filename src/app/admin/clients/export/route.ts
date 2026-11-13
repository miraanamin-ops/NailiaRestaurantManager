import { connection } from "next/server";
import { csvCell } from "@/lib/customer-csv";
import { currentFounder } from "@/lib/founder/access";
import { loadClients } from "@/lib/founder/data";
import { STANDING_LABEL } from "@/lib/founder/metrics";

// The client list as a CSV (founder only; anyone else gets 404).
export async function GET(req: Request) {
  await connection();
  if (!(await currentFounder())) return new Response("Not found", { status: 404 });
  const includeTest = new URL(req.url).searchParams.get("test") === "1";
  const { clients } = await loadClients({ includeTest });
  const head = ["Restaurant", "Owner", "Email", "WhatsApp", "Status", "Joined", "Setup finished", "Months active", "Months paid", "Trial ends", "Claude this month (USD)", "Claude all time (USD)", "Referral code", "Referred", "Referred and paying", "Last used", "Health", "Reasons"];
  const lines = clients.map((c) => [
    c.r.name,
    c.r.owner_name ?? "",
    c.r.owner_email ?? "",
    c.r.owner_whatsapp ?? "",
    STANDING_LABEL[c.standing] ?? c.standing,
    c.r.created_at.slice(0, 10),
    c.setupFinishedAt?.slice(0, 10) ?? "",
    c.monthsActive.toFixed(1),
    c.monthsPaid.toFixed(1),
    c.trialEndsAt?.slice(0, 10) ?? "",
    c.aiCostMonthUsd.toFixed(3),
    c.aiCostAllUsd.toFixed(3),
    c.r.referral_code ?? "",
    String(c.referred),
    String(c.referredPaying),
    c.lastSeenAt?.slice(0, 16).replace("T", " ") ?? "",
    c.health.light,
    c.health.reasons.map((r) => r.text).join("; "),
  ]);
  const csv = [head, ...lines].map((row) => row.map((v) => csvCell(v)).join(",")).join("\r\n");
  return new Response(`﻿${csv}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="dinerai-clients-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
    },
  });
}
