import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { getImport } from "@/lib/customer-import";
import { BASIS_WORDS, previewLines, webDeclarationText } from "@/lib/customer-import/rules";
import { getSupabase } from "@/lib/supabase";
import { button, Card, Frame, secondary } from "../../../onboarding/ui";

export const metadata: Metadata = { title: "Check your customer list", robots: { index: false, follow: false } };

// The import preview: what was found and left out, a few rows, then how these
// people agreed (required, recorded), the declaration, and double opt-in (off by default).
export default function ImportPreviewPage({ params, searchParams }: PageProps<"/customers/import/[id]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Preview params={params} searchParams={searchParams} />
    </Suspense>
  );
}

const plain = (s: string) => s.replace(/[*_]/g, "");

async function Preview({ params, searchParams }: Pick<PageProps<"/customers/import/[id]">, "params" | "searchParams">) {
  const [{ id }, q] = await Promise.all([params, searchParams]);
  const one = (k: string) => (Array.isArray(q[k]) ? q[k]![0] : (q[k] as string | undefined));
  const owner = await requireOwner(`/customers/import/${id}${one("r") ? `?r=${one("r")}` : ""}`);
  const rid = pickRestaurantId(owner, one("r"));
  const imp = rid ? await getImport(rid, id) : null;
  if (!rid || !imp) return <Frame>That import couldn&apos;t be found.</Frame>;
  if (imp.status !== "preview" || !imp.preview_rows) {
    return (
      <Frame>
        <Card>
          <p>This import is {imp.status === "cancelled" ? "cancelled" : "already done"}.</p>
          <Link className="text-emerald-700 underline" href={`/customers?r=${rid}`}>
            Back to customers
          </Link>
        </Card>
      </Frame>
    );
  }
  const { data: r } = await getSupabase().from("restaurants").select("name").eq("id", rid).maybeSingle<{ name: string }>();
  const name = r?.name ?? "your restaurant";
  const lines = previewLines(
    { total: imp.rows_total, invalid: imp.rows_invalid, duplicate: imp.rows_duplicate, existing: imp.rows_existing, suppressed: imp.rows_suppressed, to_add: imp.rows_to_add },
    ["email", imp.mapping.name !== null ? "name" : "", imp.mapping.phone !== null ? "phone" : "", imp.mapping.birthday !== null ? "birthday" : ""].filter(Boolean),
  );
  const sample = imp.preview_rows.slice(0, 5);

  return (
    <Frame>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Check your customer list</h1>
      <p className="mb-4 text-sm text-stone-600">{imp.file_name ?? "Your file"}: nothing is saved until you confirm below.</p>
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}
      <div className="space-y-5">
        <Card>
          {lines.map((l) => (
            <p key={l}>{plain(l.replace(/^📇 /, ""))}</p>
          ))}
          <table className="mt-2 w-full text-left text-sm">
            <thead className="text-stone-500">
              <tr>
                <th className="py-1 pr-2">Email</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1">Birthday</th>
              </tr>
            </thead>
            <tbody>
              {sample.map((row) => (
                <tr key={row.email} className="border-t border-stone-200">
                  <td className="py-1 pr-2 break-all">{row.email}</td>
                  <td className="py-1 pr-2">{row.name ?? ""}</td>
                  <td className="py-1">{row.birthday ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {imp.rows_to_add > sample.length && <p className="text-sm text-stone-500">…and {(imp.rows_to_add - sample.length).toLocaleString("en-GB")} more.</p>}
        </Card>

        <Card>
          <form action={`/customers/import/${imp.id}/confirm`} method="post" className="space-y-4">
            <input type="hidden" name="r" value={rid} />
            <fieldset className="space-y-2">
              <legend className="font-semibold">How did these people agree to hear from you?</legend>
              {(["opted_in", "past_customers", "unknown"] as const).map((b) => (
                <label key={b} className="flex gap-2">
                  <input type="radio" name="basis" value={b} required className="mt-1" />
                  <span>{b === "unknown" ? "I'm not sure" : BASIS_WORDS[b][0].toUpperCase() + BASIS_WORDS[b].slice(1)}</span>
                </label>
              ))}
              <p className="text-sm text-stone-500">If you&apos;re not sure, they can&apos;t be imported: under UK law even a &quot;please confirm&quot; email is marketing. Put your QR codes out instead, so they can join themselves.</p>
            </fieldset>
            <label className="flex gap-2">
              <input type="checkbox" name="declaration" value="yes" required className="mt-1" />
              <span className="text-sm">{webDeclarationText(name, imp.rows_to_add)}</span>
            </label>
            <label className="flex gap-2">
              <input type="checkbox" name="double_opt_in" value="yes" className="mt-1" />
              <span className="text-sm">Ask them to confirm their email first (only those who confirm are added to your offers)</span>
            </label>
            <p className="text-sm text-stone-500">Each one gets one welcome email first, which you approve before anything is sent. No offer reaches them until it&apos;s gone.</p>
            <button className={button} name="do" value="confirm">
              Add {imp.rows_to_add.toLocaleString("en-GB")} customers
            </button>
            <button className={secondary} name="do" value="cancel" formNoValidate>
              Cancel
            </button>
          </form>
        </Card>
      </div>
    </Frame>
  );
}
