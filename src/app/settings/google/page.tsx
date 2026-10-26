import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { pickRestaurantId, requireOwner, type Owner } from "@/lib/auth";
import { listAccounts, listLocations } from "@/lib/google/api";
import { addressText } from "@/lib/google/mapping";
import { getConnection, googleHealth, managerConnection, type GoogleConnection } from "@/lib/google/connections";
import { oauthConfigured } from "@/lib/google/oauth";
import { getRestaurant } from "@/lib/onboarding/store";
import { googleSwitch } from "@/lib/switches";
import type { Restaurant } from "@/lib/supabase";
import { button, Card, Frame } from "../../onboarding/ui";
import { chooseLocation, disconnectGoogle, importAgain } from "./actions";

export const metadata: Metadata = { title: "Google", robots: { index: false, follow: false } };

const SAVED: Record<string, string> = {
  linked: "✅ Google is connected and your details were imported.",
  imported: "✅ Imported again from Google.",
  disconnected: "✅ Google is disconnected. Nothing will be posted there.",
};
const small = "inline-block rounded-full border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50";

// Connecting a restaurant to its Google Business Profile: "Connect Google",
// then pick the location. The builder also sees DinerAI's manager account (for
// owners who add us as a Manager instead) and every restaurant's Google state.
export default function GooglePage({ searchParams }: PageProps<"/settings/google">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GoogleSettings searchParams={searchParams} />
    </Suspense>
  );
}

async function GoogleSettings({ searchParams }: Pick<PageProps<"/settings/google">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner(`/settings/google${one("r") ? `?r=${one("r")}` : ""}`);
  const rid = pickRestaurantId(owner, one("r"));
  if (!rid) return <Frame>No restaurant found for this login.</Frame>;
  const r = await getRestaurant(rid);
  const conn = r.google_connection_id ? await getConnection(r.google_connection_id) : null;
  const manager = await managerConnection();
  const pickId = one("pick");
  const picking = pickId ? await getConnection(pickId) : null;
  const canPick = picking && picking.status === "ok" && (picking.kind === "owner" ? picking.restaurant_id === rid : owner.isBuilder);
  const mode = googleSwitch(process.env);

  return (
    <Frame>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{r.name}: Google</h1>
        <Link href={`/settings?r=${rid}`} className="text-sm text-emerald-700 underline">
          Settings
        </Link>
      </div>
      {one("saved") && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">{SAVED[one("saved")!] ?? `✅ ${one("saved")}`}</p>}
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

      <div className="space-y-5">
        {canPick ? <Picker r={r} conn={picking!} /> : <Status r={r} conn={conn} />}
        {!r.google_location_id && !canPick && <ConnectCard r={r} managerEmail={process.env.GOOGLE_MANAGER_EMAIL || manager?.google_email || null} />}
        {owner.isBuilder && <BuilderCard owner={owner} r={r} manager={manager} mode={`${mode.mode}${mode.note ? ` (${mode.note})` : ""}`} />}
      </div>
    </Frame>
  );
}

function Status({ r, conn }: { r: Restaurant; conn: GoogleConnection | null }) {
  if (!r.google_location_id) return null;
  const broken = conn?.status === "needs_reconnect";
  return (
    <Card>
      <h2 className="text-lg font-bold">Connected to Google</h2>
      <p className="text-stone-700">
        <b>{r.google_location_title ?? r.google_location_id}</b>
        <br />
        <span className="text-sm text-stone-500">
          Signed in as {conn?.google_email ?? "unknown"}
          {conn?.kind === "manager" ? " (DinerAI manages it for you)" : ""}
          {r.google_imported_at ? ` · imported ${new Date(r.google_imported_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}` : ""}
        </span>
      </p>
      {broken && (
        <div className="rounded-xl bg-red-50 px-4 py-3 text-red-800">
          Google has stopped accepting this login, so new reviews and replies are on hold.
          {conn?.kind === "owner" ? (
            <a href={`/api/google/connect?r=${r.id}`} className={`${button} mt-3`}>
              Sign in to Google again
            </a>
          ) : (
            " DinerAI has been told and will fix it."
          )}
        </div>
      )}
      {r.google_import && (
        <p className="text-sm text-stone-600">
          From Google: {r.google_import.reviews.count} reviews read ({r.google_import.reviews.queued} waiting for a reply), {r.google_import.photos.length} photos
          {r.google_import.categories.length ? `, listed as ${r.google_import.categories.join(", ")}` : ""}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <form action={importAgain}>
          <input type="hidden" name="r" value={r.id} />
          <button className={small}>Import again</button>
        </form>
        <form action={disconnectGoogle}>
          <input type="hidden" name="r" value={r.id} />
          <button className={`${small} text-red-700`}>Disconnect</button>
        </form>
      </div>
      <p className="text-xs text-stone-500">Replies and posts still only go up once you approve them on WhatsApp.</p>
    </Card>
  );
}

function ConnectCard({ r, managerEmail }: { r: Restaurant; managerEmail: string | null }) {
  return (
    <Card>
      <h2 className="text-lg font-bold">Connect your Google Business Profile</h2>
      <p className="text-stone-700">So DinerAI can see new reviews, post the replies and posts you approve, and keep your hours up to date.</p>
      {oauthConfigured() ? (
        <a href={`/api/google/connect?r=${r.id}`} className={button}>
          Connect Google
        </a>
      ) : (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Google sign-in isn&apos;t switched on yet.</p>
      )}
      <p className="text-sm text-stone-500">
        Google may say it hasn&apos;t verified the app yet: tap <b>Advanced</b>, then <b>Go to DinerAI</b>.
      </p>
      {managerEmail && (
        <p className="text-sm text-stone-600">
          Prefer not to sign in? In your Business Profile open ⋮ → <b>Business Profile settings</b> → <b>Managers</b> → <b>Add</b>, and add <b>{managerEmail}</b> as a Manager. We&apos;ll link it for you.
        </p>
      )}
    </Card>
  );
}

// Every location the login can see, across its accounts.
async function Picker({ r, conn }: { r: Restaurant; conn: GoogleConnection }) {
  let rows: { account: string; accountName: string; location: string; title: string; address: string | null }[] = [];
  let error: string | null = null;
  try {
    for (const a of await listAccounts(conn)) {
      for (const l of await listLocations(conn, a.name)) rows.push({ account: a.name, accountName: a.accountName ?? a.name, location: l.name, title: l.title ?? l.name, address: addressText(l.storefrontAddress) });
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    rows = [];
  }
  return (
    <Card>
      <h2 className="text-lg font-bold">Which one is {r.name}?</h2>
      <p className="text-sm text-stone-600">Signed in as {conn.google_email ?? "your Google account"}. These are the businesses it manages.</p>
      {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">Couldn&apos;t read your businesses from Google: {error}</p>}
      {!error && !rows.length && <p className="text-stone-700">This Google account doesn&apos;t manage any business locations. Sign in with the account that owns your Business Profile.</p>}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.location}>
            <form action={chooseLocation} className="flex items-center justify-between gap-3 rounded-xl border border-stone-200 px-4 py-3">
              <input type="hidden" name="r" value={r.id} />
              <input type="hidden" name="c" value={conn.id} />
              <input type="hidden" name="account" value={row.account} />
              <input type="hidden" name="location" value={row.location} />
              <span>
                <b>{row.title}</b>
                <br />
                <span className="text-sm text-stone-500">{row.address ?? row.accountName}</span>
              </span>
              <button className={small}>This is us</button>
            </form>
          </li>
        ))}
      </ul>
      <a href={`/api/google/connect?r=${r.id}`} className="text-sm text-emerald-700 underline">
        Use a different Google account
      </a>
    </Card>
  );
}

async function BuilderCard({ owner, r, manager, mode }: { owner: Owner; r: Restaurant; manager: GoogleConnection | null; mode: string }) {
  const health = await googleHealth();
  const rows = health.rows.filter((x) => owner.restaurantIds.includes(x.id));
  return (
    <Card>
      <h2 className="text-lg font-bold">Builder: Google</h2>
      <p className="text-sm text-stone-600">
        GOOGLE_MODE: <b>{mode}</b>. Restaurants without a linked location use dummy Google.
      </p>
      <div className="text-sm">
        <b>DinerAI manager account:</b>{" "}
        {manager ? (
          <>
            {manager.google_email} {manager.status === "needs_reconnect" ? <span className="font-semibold text-red-700">needs reconnecting</span> : "✅"}
          </>
        ) : (
          "not connected"
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <a href="/api/google/connect?as=manager" className={small}>
            {manager ? "Reconnect" : "Connect"} manager account
          </a>
          {manager?.status === "ok" && (
            <a href={`/settings/google?r=${r.id}&pick=${manager.id}`} className={small}>
              Link {r.name} from the manager account
            </a>
          )}
        </div>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-stone-500">
          <tr>
            <th className="py-1">Restaurant</th>
            <th>Location</th>
            <th>Login</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.id} className="border-t border-stone-100">
              <td className="py-1">
                <Link href={`/settings/google?r=${x.id}`} className="underline">
                  {x.name}
                </Link>
              </td>
              <td>{x.google_location_title ?? "dummy"}</td>
              <td className={x.connection?.status === "needs_reconnect" ? "font-semibold text-red-700" : ""}>
                {x.connection ? `${x.connection.kind === "manager" ? "manager" : "owner"}: ${x.connection.status === "ok" ? "ok" : `NEEDS RECONNECT (${x.connection.last_error ?? ""})`}` : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
