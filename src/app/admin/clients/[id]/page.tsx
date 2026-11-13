import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { connection } from "next/server";
import { PageSkeleton } from "@/components/app-shell";
import { logAction } from "@/lib/audit";
import { PRICE_GBP } from "@/lib/billing/config";
import { canSkipCoolingOff, closeRefused } from "@/lib/closure-rules";
import { requireFounder } from "@/lib/founder/access";
import { loadClient } from "@/lib/founder/client";
import { isTestSite } from "@/lib/founder/data";
import { pounds, STANDING_LABEL } from "@/lib/founder/metrics";
import { cancelDelete, confirmDelete, requestDelete, retryJob } from "../../actions";
import { AdminPage, Card, day, H1, H2, Light, months1, usd, when } from "../../_ui";

// One client: what they pay, how healthy they are, what went wrong lately, how
// they use DinerAI, what they cost, and their setup. Each visit is in the audit log
// ("founder_viewed"; never shown to the owner).
export default function ClientPage({ params, searchParams }: PageProps<"/admin/clients/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ClientBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const USAGE_LABELS: Record<string, string> = {
  owner_in: "Messages from the owner",
  approvals: "Drafts approved",
  edits: "Drafts edited",
  skips: "Drafts skipped",
  emails: "Customer emails sent",
  whatsapp_out: "WhatsApp messages to the owner",
  app_out: "App messages to the owner",
  minutes_saved: "Minutes saved",
};

const btn = "inline-flex h-9 items-center rounded-full px-3 text-[13px] font-medium ring-1 ring-[#2c3127] text-[#edefe8] hover:ring-[#3a4034]";
const input = "h-9 rounded-full bg-[#0b0c0a] px-3 text-[13px] text-[#edefe8] ring-1 ring-[#2c3127]";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-[#6e7468]">{label}</div>
      <div className="mt-0.5 text-[14px] text-[#edefe8]">{children || "–"}</div>
    </div>
  );
}

async function ClientBody({ params, searchParams }: Pick<PageProps<"/admin/clients/[id]">, "params" | "searchParams">) {
  await connection();
  const { id } = await params;
  const me = await requireFounder(`/admin/clients/${id}`);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const d = await loadClient(id);
  if (!d) notFound();
  await logAction({ restaurantId: id, actor: "founder", action: "founder_viewed", detail: `Opened on the founder dashboard by ${me.email}` });

  const { client: c, restaurant: r } = d;
  const plan = c.standing === "pilot" ? "Pilot (invite code)" : c.standing === "exempt" ? "Free (billing exempt)" : r.store_status && !["trialing", "active", "past_due"].includes(r.subscription_status ?? "") ? `App store (${r.store_platform === "play_store" ? "Google Play" : "App Store"})` : r.stripe_customer_id ? "Stripe" : "–";
  const lastPaid = c.payments[c.payments.length - 1];
  const nextDate = c.standing === "trialing" ? c.trialEndsAt : r.subscription_status ? r.current_period_end : r.store_period_end;
  const copyText = [
    r.name,
    `Owner: ${r.owner_name ?? "–"} <${r.owner_email ?? "–"}>`,
    `WhatsApp: ${r.owner_whatsapp ?? "–"} · Phone: ${r.phone ?? "–"}`,
    `Address: ${r.address ?? "–"}`,
    `Status: ${STANDING_LABEL[c.standing]} · Joined ${day(c.r.created_at)} · Months active ${months1(c.monthsActive)}`,
    `Restaurant id: ${r.id}`,
  ].join("\n");
  const refused = closeRefused(r);

  return (
    <AdminPage>
      <div>
        <Link href="/admin/clients" className="text-[13px] text-[#a3a99d] hover:text-[#edefe8]">
          ← All clients
        </Link>
      </div>
      <H1
        sub={
          <span className="flex flex-wrap items-center gap-3">
            <span>{c.closing ? "Closing" : STANDING_LABEL[c.standing]}</span>
            <Light light={c.health.light} />
            {isTestSite(c.r) && <span className="rounded-full bg-[#1e221b] px-2 py-0.5 text-[11px]">test site</span>}
            {r.paused && <span className="rounded-full bg-[#ffb23d]/15 px-2 py-0.5 text-[11px] text-[#ffb23d]">sending paused</span>}
          </span>
        }
      >
        {r.name}
      </H1>

      {one("done") && <div className="rounded-2xl bg-[#c8f03c]/10 px-4 py-3 text-[14px] text-[#e4f9a8] ring-1 ring-[#c8f03c]/25">{one("done")}</div>}
      {one("error") && <div className="rounded-2xl bg-[#ff8a6e]/10 px-4 py-3 text-[14px] text-[#ffc9ba] ring-1 ring-[#ff8a6e]/30">{one("error")}</div>}

      <section className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <H2>Key facts</H2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Fact label="Owner">{r.owner_name}</Fact>
            <Fact label="Email">{r.owner_email}</Fact>
            <Fact label="WhatsApp">{r.owner_whatsapp}</Fact>
            <Fact label="Signed up">{day(c.r.created_at)}</Fact>
            <Fact label="Setup finished">{c.setupFinishedAt ? day(c.setupFinishedAt) : "Not yet"}</Fact>
            <Fact label="Months active">{months1(c.monthsActive)}</Fact>
            <Fact label="Months paid">{c.monthsPaid ? months1(c.monthsPaid) : "None"}</Fact>
            <Fact label="Plan">{plan}</Fact>
            <Fact label="Last payment">{lastPaid ? `${pounds(lastPaid.amount_pence ?? 0, { exact: true })} on ${day(lastPaid.at)}` : `None recorded (list price £${PRICE_GBP})`}</Fact>
            <Fact label={c.standing === "trialing" ? "Trial ends" : "Next payment"}>
              {nextDate ? day(nextDate) : "–"}
              {(r.cancel_at_period_end || r.store_cancel_at_period_end) && <span className="ml-1 text-[#ffb23d]">(cancelled, ends then)</span>}
            </Fact>
            <Fact label="Stripe">
              {r.stripe_customer_id ? (
                <a href={`https://dashboard.stripe.com/customers/${r.stripe_customer_id}`} target="_blank" rel="noreferrer" className="underline">
                  Open customer
                </a>
              ) : null}
            </Fact>
            <Fact label="App since">{r.app_since ? day(r.app_since) : "Not on the app"}</Fact>
            <Fact label="Referral code">{r.referral_code}</Fact>
            <Fact label="Referred by">{d.referrer}</Fact>
            <Fact label="Referred others">
              {d.referredList.length ? `${d.referredList.length} (${c.referredPaying} paying)` : "None"}
              {r.referral_credited_at && <span className="ml-1 text-[#a3a99d]">· free month given {day(r.referral_credited_at)}</span>}
            </Fact>
          </div>
          {d.referredList.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
              {d.referredList.map((x) => (
                <Link key={x.id} href={`/admin/clients/${x.id}`} className="rounded-full bg-[#1e221b] px-2.5 py-1 text-[#a3a99d] hover:text-[#edefe8]">
                  {x.name} · {STANDING_LABEL[x.standing]}
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card>
          <H2>Health</H2>
          {c.health.reasons.length ? (
            <ul className="space-y-2 text-[13px]">
              {c.health.reasons.map((x) => (
                <li key={x.text} className="flex gap-2">
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: x.tone === "red" ? "#ff7a3d" : "#ffb23d" }} />
                  <span className="text-[#edefe8]">{x.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[#c8f03c]">Nothing wrong that we can see.</p>
          )}
          <div className="mt-4 text-[12px] text-[#a3a99d]">Last used: {when(c.lastSeenAt)}</div>
        </Card>
      </section>

      <section>
        <H2 aside={<span className="text-[12px] text-[#6e7468]">Last 30 days, newest first</span>}>Problems</H2>
        {d.problems.length ? (
          <div className="divide-y divide-[#1e221b] overflow-hidden rounded-2xl bg-[#171a14]">
            {d.problems.slice(0, 60).map((p, i) => (
              <div key={i} className="flex flex-wrap items-start gap-3 px-4 py-2.5 text-[13px]">
                <span className="w-32 shrink-0 text-[#6e7468]">{when(p.at)}</span>
                <span className={`w-32 shrink-0 font-medium ${p.tone === "red" ? "text-[#ff7a3d]" : p.tone === "amber" ? "text-[#ffb23d]" : "text-[#a3a99d]"}`}>{p.kind}</span>
                <span className="min-w-0 flex-1 whitespace-pre-line break-words text-[#edefe8]">{p.text}</span>
                {p.jobId && (
                  <form action={retryJob}>
                    <input type="hidden" name="r" value={r.id} />
                    <input type="hidden" name="job" value={p.jobId} />
                    <button className={btn}>Retry</button>
                  </form>
                )}
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <p className="text-[13px] text-[#a3a99d]">No problems recorded in the last 30 days.</p>
          </Card>
        )}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <H2>Usage</H2>
          <table className="w-full text-[13px]">
            <thead className="text-left text-[11px] uppercase tracking-wider text-[#6e7468]">
              <tr>
                <th className="pb-2 font-medium" />
                <th className="pb-2 text-right font-medium">This month</th>
                <th className="pb-2 text-right font-medium">Last month</th>
              </tr>
            </thead>
            <tbody>
              {d.usage.map((u) => (
                <tr key={u.metric} className="border-t border-[#1e221b]">
                  <td className="py-1.5 text-[#edefe8]">{USAGE_LABELS[u.metric]}</td>
                  <td className="py-1.5 text-right font-mono text-[#edefe8]">{u.thisMonth}</td>
                  <td className="py-1.5 text-right font-mono text-[#a3a99d]">{u.lastMonth}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card>
          <H2>Claude costs</H2>
          <div className="mb-3 flex gap-6">
            <div>
              <div className="text-[22px] font-semibold text-[#edefe8]">{usd(c.aiCostMonthUsd)}</div>
              <div className="text-[12px] text-[#a3a99d]">this month</div>
            </div>
            <div>
              <div className="text-[22px] font-semibold text-[#edefe8]">{usd(c.aiCostAllUsd)}</div>
              <div className="text-[12px] text-[#a3a99d]">all time</div>
            </div>
            <div>
              <div className="text-[22px] font-semibold text-[#edefe8]">{pounds(lastPaid?.amount_pence ?? (["active", "past_due"].includes(c.standing) ? PRICE_GBP * 100 : 0))}</div>
              <div className="text-[12px] text-[#a3a99d]">they pay a month</div>
            </div>
          </div>
          <table className="w-full text-[13px]">
            <tbody>
              {d.costs.map((x) => (
                <tr key={x.purpose} className="border-t border-[#1e221b]">
                  <td className="py-1.5 text-[#edefe8]">{x.purpose}</td>
                  <td className="py-1.5 text-right font-mono text-[#edefe8]">{usd(x.month)}</td>
                  <td className="py-1.5 text-right font-mono text-[#a3a99d]">{usd(x.all)} all time</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!d.costs.length && <p className="text-[13px] text-[#a3a99d]">Nothing recorded yet.</p>}
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <H2>Their setup</H2>
          <div className="grid grid-cols-2 gap-4 text-[13px]">
            <Fact label="Google">{r.google_location_id ? `Linked ${day(r.google_linked_at)}` : "Not linked"}</Fact>
            <Fact label="Sales data up to">{d.salesThrough ? day(d.salesThrough) : "None"}</Fact>
            <Fact label="Team">{d.staffCount ? `${d.staffCount} people` : "None added"}</Fact>
            <Fact label="Setup steps">
              {d.steps.length ? `${d.steps.filter((s) => s.status === "done").length} done, ${d.steps.filter((s) => s.status === "partial").length} partial, ${d.steps.filter((s) => s.status === "skipped").length} skipped` : "Older setup"}
            </Fact>
          </div>
          {d.gaps.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-wider text-[#6e7468]">Setup gaps</div>
              <ul className="mt-1 space-y-1 text-[13px] text-[#edefe8]">
                {d.gaps.map((g) => (
                  <li key={g.step_key}>· {g.unlock_text}</li>
                ))}
              </ul>
            </div>
          )}
          {d.agents.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-wider text-[#6e7468]">Assistants</div>
              <table className="mt-1 w-full text-[13px]">
                <tbody>
                  {d.agents.map((a) => (
                    <tr key={a.agent} className="border-t border-[#1e221b]">
                      <td className="py-1.5 capitalize text-[#edefe8]">{a.agent}</td>
                      <td className={`py-1.5 ${a.running === "live" ? "text-[#c8f03c]" : a.set === "live" ? "text-[#ffb23d]" : "text-[#a3a99d]"}`}>
                        {a.running}
                        {a.set !== a.running ? ` (set to ${a.set})` : ""}
                      </td>
                      <td className="py-1.5 text-[12px] text-[#a3a99d]">{a.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <H2>Billing history</H2>
          {d.history.length ? (
            <table className="w-full text-[13px]">
              <tbody>
                {d.history.map((h, i) => (
                  <tr key={i} className="border-t border-[#1e221b]">
                    <td className="py-1.5 pr-3 text-[#6e7468]">{day(h.at)}</td>
                    <td className="py-1.5 text-[#edefe8]">
                      {h.kind === "payment" ? `Paid ${pounds(h.amount_pence ?? 0, { exact: true })}` : STANDING_LABEL[h.standing ?? ""] ?? h.standing}
                      {h.cancel_reason && <span className="text-[#ffb23d]"> · reason: {h.cancel_reason}</span>}
                      {h.detail && h.kind === "standing" && <div className="text-[11px] text-[#6e7468]">{h.detail}</div>}
                    </td>
                    <td className="py-1.5 text-right text-[11px] text-[#6e7468]">{h.source.replace("_", " ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[13px] text-[#a3a99d]">Nothing recorded yet.</p>
          )}
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <H2>Recent conversation</H2>
          <p className="mb-3 text-[12px] text-[#ffb23d]">Private: the owner&apos;s own messages. Opening this page is logged.</p>
          <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
            {d.conversation.map((m, i) => (
              <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] ${m.direction === "inbound" ? "bg-[#1e221b] text-[#edefe8]" : "ml-auto bg-[#c8f03c]/10 text-[#e4f9a8]"}`}>
                <div className="whitespace-pre-line break-words">{m.body || "(a picture or file)"}</div>
                <div className="mt-1 text-[10px] text-[#6e7468]">
                  {m.direction === "inbound" ? "Owner" : "DinerAI"} · {m.app ? "app" : "WhatsApp"} · {when(m.created_at)}
                </div>
              </div>
            ))}
            {!d.conversation.length && <p className="text-[13px] text-[#a3a99d]">No messages yet.</p>}
          </div>
        </Card>
        <Card>
          <H2>Recent activity</H2>
          <table className="w-full text-[13px]">
            <tbody>
              {d.audit.map((a, i) => (
                <tr key={i} className="border-t border-[#1e221b] align-top">
                  <td className="w-28 py-1.5 pr-2 text-[11px] text-[#6e7468]">{when(a.created_at)}</td>
                  <td className="py-1.5 text-[#edefe8]">
                    {a.detail ?? a.action}
                    <span className="ml-1 text-[11px] text-[#6e7468]">({a.actor})</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <Card>
          <H2>Quick actions</H2>
          <div className="flex flex-wrap gap-2">
            <Link href={`/log?r=${r.id}`} className={btn}>
              Their activity log
            </Link>
            <Link href={`/?r=${r.id}`} className={btn}>
              Their dashboard
            </Link>
            {r.slug && (
              <Link href={`/review/${r.slug}`} className={btn}>
                Business review
              </Link>
            )}
          </div>
          <p className="mt-2 text-[12px] text-[#6e7468]">Their log and dashboard open with your builder login (they show the restaurant as the owner sees it).</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] text-[#a3a99d]">Copy their details</summary>
            <textarea readOnly rows={6} defaultValue={copyText} className="mt-2 w-full rounded-xl bg-[#0b0c0a] p-3 font-mono text-[12px] text-[#edefe8] ring-1 ring-[#2c3127]" />
          </details>
        </Card>

        <Card className="ring-1 ring-[#ff7a3d]/30">
          <div id="delete" />
          <H2>Delete their account</H2>
          {refused ? (
            <p className="text-[13px] text-[#a3a99d]">{refused}</p>
          ) : !d.closure ? (
            <>
              <p className="text-[13px] text-[#a3a99d]">
                Two steps. Nothing changes at the first. Confirming pauses sending and emails the owner; after a 24-hour cooling-off (which you can cancel) their data is exported and emailed to them, Google access and Stripe are stopped, and everything is deleted. One anonymous line is kept.
              </p>
              <form action={requestDelete} className="mt-3 flex flex-wrap gap-2">
                <input type="hidden" name="r" value={r.id} />
                <input name="name" required autoComplete="off" placeholder={`Type "${r.name}"`} aria-label={`Type the restaurant name, ${r.name}`} className={`${input} min-w-[220px] flex-1`} />
                <button className={`${btn} text-[#ff8a6e]`}>Request deletion</button>
              </form>
            </>
          ) : d.closure.status === "requested" ? (
            <form action={confirmDelete} className="space-y-2">
              <p className="text-[13px] text-[#edefe8]">Deletion requested {when(d.closure.requested_at)} ({d.closure.ref}). Nothing has changed yet.</p>
              <input type="hidden" name="r" value={r.id} />
              <input type="hidden" name="c" value={d.closure.id} />
              <input name="name" required autoComplete="off" placeholder={`Type "${r.name}" again`} aria-label={`Type the restaurant name, ${r.name}, again`} className={`${input} w-full`} />
              <label className="flex items-center gap-2 text-[13px] text-[#edefe8]">
                <input type="checkbox" name="understood" required /> I understand everything for {r.name} will be deleted, and it can&apos;t be undone.
              </label>
              {canSkipCoolingOff(r) && (
                <label className="flex items-center gap-2 text-[13px] text-[#a3a99d]">
                  <input type="checkbox" name="skip" /> Skip the 24-hour cooling-off (test sites only)
                </label>
              )}
              <div className="flex gap-2">
                <button className={`${btn} text-[#ff8a6e]`}>Confirm deletion</button>
              </div>
            </form>
          ) : (
            <p className="text-[13px] text-[#edefe8]">
              {d.closure.status === "scheduled" ? `Deleting ${when(d.closure.closes_at)} (${d.closure.ref}). Sending is paused.` : d.closure.status === "failed" ? `Deletion failed (${d.closure.ref}): retry it on the builder's close-account page.` : `Deleting now (${d.closure.ref}).`}
            </p>
          )}
          {d.closure && ["requested", "scheduled", "failed"].includes(d.closure.status) && (
            <form action={cancelDelete} className="mt-3">
              <input type="hidden" name="r" value={r.id} />
              <input type="hidden" name="c" value={d.closure.id} />
              <button className={btn}>Cancel the deletion</button>
            </form>
          )}
        </Card>
      </section>
    </AdminPage>
  );
}
