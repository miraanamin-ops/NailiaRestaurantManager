import { importsForAdmin } from "@/lib/customer-import";
import { Card } from "@/app/onboarding/ui";

// Customer list imports across restaurants: rows, sent, bounce rate (paused over 5%).
export async function ImportsSection() {
  const imports = await importsForAdmin().catch((err: unknown) => ({ error: String(err) }));
  if ("error" in imports) return <p className="mt-3 text-sm text-amber-800">Couldn&apos;t load imports ({imports.error}). Has migration 064 been run?</p>;
  const totalSent = imports.reduce((n, i) => n + i.sent, 0);
  const totalBounced = imports.reduce((n, i) => n + i.bounced, 0);
  return (
    <>
      <h2 className="mt-8 text-xl font-semibold">Customer imports</h2>
      <Card>
        <p className="text-sm">
          Latest {imports.length}: {imports.reduce((n, i) => n + i.rows_added, 0)} customers added, {totalSent} welcome emails sent, {totalBounced} bounced
          {totalSent ? ` (${Math.round((totalBounced / totalSent) * 1000) / 10}%)` : ""}, {imports.filter((i) => i.status === "paused").length} paused.
        </p>
      </Card>
      {imports.length > 0 && (
        <div className="mt-3 space-y-2">
          {imports.map((i) => (
            <Card key={i.id}>
              <p className="text-sm text-stone-500">
                {new Date(i.created_at).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" })} · {i.restaurant} · {i.status}
                {i.basis ? ` · ${i.basis === "opted_in" ? "opted in" : "past customers"}` : ""}
              </p>
              <p className="text-sm">
                {i.file_name ?? "A file"}: {i.rows_added} added · {i.sent} sent · {i.bounced} bounced ({i.bounce_rate}%) · {i.unsubscribed} unsubscribed
                {i.paused_reason ? <b className="text-amber-700"> · paused: {i.paused_reason}</b> : null}
              </p>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
