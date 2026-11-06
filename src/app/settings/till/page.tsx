import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { getRestaurant } from "@/lib/onboarding/store";
import { lightspeedLocations, squareLocations, toastRestaurants } from "@/lib/tills/clients";
import { liveReady, missingSettings, PROVIDER_ORDER, PROVIDERS } from "@/lib/tills/providers";
import { syncStatusLine } from "@/lib/tills/rules";
import { credentialsOf, tillFor } from "@/lib/tills/store";
import { dummyTillAllowed, notReady } from "@/lib/tills/sync";
import type { TillConnection } from "@/lib/tills/types";
import { button, Card, Frame, input } from "../../onboarding/ui";
import { chooseTillLocation, connectDummyTill, connectEposNow, disconnectTillAction, linkToast, syncTillNow } from "./actions";

export const metadata: Metadata = { title: "Till", robots: { index: false, follow: false } };

const SAVED: Record<string, string> = {
  connected: "✅ Your till is connected. Your sales are on their way in: the last 90 days take a few hours.",
  pick: "✅ Signed in. Now pick which location to read.",
  syncing: "✅ Syncing now. New sales show up within a few minutes.",
  disconnected: "✅ Your till is disconnected. Sales already read are kept.",
};
const small = "inline-block rounded-full border border-stone-300 px-4 py-2 text-sm font-medium hover:bg-stone-50";

// Connecting the restaurant's till (EPOS): Square, Epos Now, Lightspeed or Toast.
// Once connected, sales come in every hour, the same way an uploaded sales file
// does. We only ever read: nothing here can change the till.
export default function TillPage({ searchParams }: PageProps<"/settings/till">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TillSettings searchParams={searchParams} />
    </Suspense>
  );
}

async function TillSettings({ searchParams }: Pick<PageProps<"/settings/till">, "searchParams">) {
  await connection(); // the page shows "last synced N minutes ago": always rendered fresh
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner(`/settings/till${one("r") ? `?r=${one("r")}` : ""}`);
  const rid = pickRestaurantId(owner, one("r"));
  if (!rid) return <Frame>No restaurant found for this login.</Frame>;
  const r = await getRestaurant(rid);
  const c = await tillFor(rid);

  return (
    <Frame>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{r.name}: till</h1>
        <Link href={`/settings?r=${rid}`} className="text-sm text-emerald-700 underline">
          Settings
        </Link>
      </div>
      {one("saved") && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">{SAVED[one("saved")!] ?? `✅ ${one("saved")}`}</p>}
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

      <div className="space-y-5">
        {c ? <Connected rid={rid} c={c} /> : <Choose rid={rid} />}
        {!c && dummyTillAllowed(r) && <DummyCard rid={rid} />}
        {owner.isBuilder && <BuilderCard rid={rid} c={c} />}
      </div>
    </Frame>
  );
}

async function Connected({ rid, c }: { rid: string; c: TillConnection }) {
  const name = PROVIDERS[c.provider].name;
  const waiting = notReady(c);
  const needsLocation = waiting && (c.provider === "square" || c.provider === "lightspeed");
  return (
    <Card>
      <h2 className="text-lg font-bold">Connected to {name}</h2>
      <p className="text-stone-700">
        {c.location_name && <b>{c.location_name}</b>}
        {c.mode === "dummy" && <span className="block text-sm text-stone-500">🧪 A pretend till made from your menu, for testing.</span>}
      </p>
      {needsLocation ? <LocationPicker rid={rid} c={c} /> : <p className="text-sm text-stone-700">{waiting ? `Waiting: ${waiting}.` : syncStatusLine(c, new Date())}</p>}
      <p className="text-sm text-stone-600">Your sales (each dish, every order) come in every hour. They feed your forecasts, menu insights, morning brief and weekly report. DinerAI only reads from your till; it can&apos;t change anything on it.</p>
      <div className="flex flex-wrap gap-2">
        {!waiting && (
          <form action={syncTillNow}>
            <input type="hidden" name="r" value={rid} />
            <button className={small}>Sync now</button>
          </form>
        )}
        {c.status === "needs_reconnect" && PROVIDERS[c.provider].method === "oauth" && (
          <a className={small} href={`/api/till/${c.provider}/connect?r=${rid}`}>
            Connect {name} again
          </a>
        )}
        <form action={disconnectTillAction}>
          <input type="hidden" name="r" value={rid} />
          <button className={small}>Disconnect</button>
        </form>
      </div>
    </Card>
  );
}

async function LocationPicker({ rid, c }: { rid: string; c: TillConnection }) {
  const creds = credentialsOf(c);
  const list = creds?.kind === "oauth" ? await (c.provider === "square" ? squareLocations(creds.access_token) : lightspeedLocations(creds.access_token)).catch(() => []) : [];
  if (!list.length) return <p className="text-sm text-red-800">We couldn&apos;t load your locations. Please disconnect and connect again.</p>;
  return (
    <form action={chooseTillLocation} className="space-y-3">
      <input type="hidden" name="r" value={rid} />
      <p className="text-sm font-medium">Which location is this restaurant?</p>
      {list.map((l) => (
        <label key={l.id} className="flex items-center gap-2">
          <input type="radio" name="location" value={l.id} required /> {l.name}
        </label>
      ))}
      <button className={button}>This is us</button>
    </form>
  );
}

function Choose({ rid }: { rid: string }) {
  return (
    <>
      <Card>
        <h2 className="text-lg font-bold">Connect your till</h2>
        <p className="text-stone-700">Connect your till once and your sales come in by themselves, every hour. No more exporting spreadsheets. Pick the one you use:</p>
      </Card>
      {PROVIDER_ORDER.map((id) => {
        const p = PROVIDERS[id];
        const ready = liveReady(id, process.env);
        return (
          <Card key={id}>
            <h3 className="text-base font-bold">{p.name}</h3>
            <p className="text-sm text-stone-700">{p.howTo}</p>
            {!ready ? (
              <p className="text-sm text-stone-500">Coming soon. Until then, you can still send your sales as a spreadsheet.</p>
            ) : p.method === "oauth" ? (
              <a className={button} href={`/api/till/${id}/connect?r=${rid}`}>
                Connect {p.name.split(" ")[0]}
              </a>
            ) : p.method === "api_key" ? (
              <form action={connectEposNow} className="space-y-2">
                <input type="hidden" name="r" value={rid} />
                <input className={input} name="key" placeholder="API key" autoComplete="off" required />
                <input className={input} name="secret" placeholder="API secret" autoComplete="off" required />
                <button className={button}>Connect Epos Now</button>
              </form>
            ) : (
              <p className="text-sm text-stone-600">Once you&apos;ve switched DinerAI on in Toast, message us on WhatsApp and we&apos;ll link it.</p>
            )}
          </Card>
        );
      })}
    </>
  );
}

function DummyCard({ rid }: { rid: string }) {
  return (
    <Card>
      <h2 className="text-lg font-bold">🧪 Test: a dummy till</h2>
      <p className="text-sm text-stone-600">Demo restaurants only, never on the live site. Pretend orders made from your menu, read exactly like a real till.</p>
      <div className="flex flex-wrap gap-2">
        {PROVIDER_ORDER.map((id) => (
          <form key={id} action={connectDummyTill}>
            <input type="hidden" name="r" value={rid} />
            <input type="hidden" name="provider" value={id} />
            <button className={small}>Dummy {PROVIDERS[id].name.split(" ")[0]}</button>
          </form>
        ))}
      </div>
    </Card>
  );
}

async function BuilderCard({ rid, c }: { rid: string; c: TillConnection | null }) {
  const toastReady = liveReady("toast", process.env);
  const toast = toastReady && !c ? await toastRestaurants().catch((e: unknown) => (e instanceof Error ? e.message : String(e))) : null;
  return (
    <Card>
      <h2 className="text-lg font-bold">Builder</h2>
      <ul className="text-sm text-stone-700">
        {PROVIDER_ORDER.map((id) => {
          const missing = missingSettings(id, process.env);
          return (
            <li key={id}>
              {PROVIDERS[id].name}: {missing.length ? `off (missing ${missing.join(", ")})` : "on"}
            </li>
          );
        })}
      </ul>
      {c && (
        <p className="text-xs text-stone-500">
          Connection {c.id} · {c.provider} · {c.mode} · {c.status} · synced through {c.synced_through ?? "never"}
          {c.last_error ? ` · last error: ${c.last_error}` : ""}
        </p>
      )}
      {typeof toast === "string" && <p className="text-sm text-red-800">Toast: {toast}</p>}
      {Array.isArray(toast) && (
        <form action={linkToast} className="space-y-2">
          <input type="hidden" name="r" value={rid} />
          <p className="text-sm font-medium">Link a Toast restaurant ({toast.length} have switched DinerAI on)</p>
          <select name="guid" className={input} required>
            {toast.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className={small}>Link Toast</button>
        </form>
      )}
    </Card>
  );
}
