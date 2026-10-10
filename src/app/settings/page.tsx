import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { pickRestaurantId, requireOwner } from "@/lib/auth";
import { DAYS } from "@/lib/onboarding/profile-data";
import { getRestaurant } from "@/lib/onboarding/store";
import { AllergenEditor, MenuEditor } from "../onboarding/setup/editors";
import { button, Card, Frame, input } from "../onboarding/ui";
import { saveDetails, saveSettingsAllergens, saveSettingsMenu } from "./actions";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

const SAVED: Record<string, string> = { details: "✅ Details saved.", menu: "✅ Menu saved.", allergens: "✅ Allergens confirmed." };

// Change anything set up during onboarding. (Or just message Naila on WhatsApp:
// "change Friday hours to 11pm", "add lamb chops, £14".)
export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Settings searchParams={searchParams} />
    </Suspense>
  );
}

async function Settings({ searchParams }: Pick<PageProps<"/settings">, "searchParams">) {
  const q = await searchParams;
  const one = (k: string) => (Array.isArray(q[k]) ? q[k][0] : q[k]);
  const owner = await requireOwner(`/settings${one("r") ? `?r=${one("r")}` : ""}`);
  const restaurantId = pickRestaurantId(owner, one("r"));
  if (!restaurantId) return <Frame>No restaurant found for this login.</Frame>;
  const r = await getRestaurant(restaurantId);
  const unconfirmed = (r.menu ?? []).some((c) => c.items.some((i) => !i.allergens_confirmed));
  const label = "text-sm font-medium";

  return (
    <Frame>
      <div className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{r.name}: settings</h1>
        <Link href={`/?r=${restaurantId}`} className="text-sm text-emerald-700 underline">
          Dashboard
        </Link>
      </div>
      <p className="mb-4 text-sm text-stone-600">
        Tip: you can also just tell Naila on WhatsApp, e.g. <i>change Friday hours to 11pm</i> or <i>add lamb chops, £14</i>. Every change can be undone by sending <b>UNDO</b>.
      </p>
      {one("saved") && <p className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-900">{SAVED[one("saved")!]}</p>}
      {one("error") && <p className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-red-800">{one("error")}</p>}

      <div className="space-y-5">
        <Card>
          <h2 className="text-lg font-bold">Details</h2>
          <form action={saveDetails} className="space-y-4">
            <input type="hidden" name="r" value={restaurantId} />
            <fieldset className="space-y-2">
              <legend className={label}>Opening hours</legend>
              {DAYS.map((day) => (
                <label key={day} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm">{day}</span>
                  <input name={`hours_${day}`} defaultValue={r.opening_hours?.[day] ?? ""} placeholder="12:00 – 22:00 or Closed" className={input} />
                </label>
              ))}
            </fieldset>
            <label className="block">
              <span className={label}>Phone</span>
              <input name="phone" type="tel" defaultValue={r.phone ?? ""} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Address</span>
              <input name="address" defaultValue={r.address ?? ""} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Website</span>
              <input name="website" inputMode="url" defaultValue={r.website ?? ""} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Sign-up reward</span>
              <input name="reward" defaultValue={r.signup_reward ?? ""} maxLength={100} className={`mt-1 ${input}`} />
            </label>
            <label className="block">
              <span className={label}>Biggest discount (%)</span>
              <input name="cap" type="number" min={0} max={100} defaultValue={r.discount_cap_percent} className={`mt-1 ${input}`} />
            </label>
            <button className={button}>Save details</button>
          </form>
        </Card>

        <Card>
          <h2 className="text-lg font-bold">Menu</h2>
          {(r.menu ?? []).length ? null : <p className="text-sm text-stone-600">No menu yet. Add dishes below, or send photos of your menu on WhatsApp during set-up.</p>}
          <MenuEditor
            initial={(r.menu ?? []).length ? r.menu : [{ category: "Menu", items: [{ name: "", price: 0, description: null }] }]}
            save={saveSettingsMenu.bind(null, restaurantId)}
            label="Save menu"
          />
        </Card>

        {(r.menu ?? []).length > 0 && (
          <Card>
            <h2 className="text-lg font-bold">Allergens</h2>
            <p className="text-sm text-stone-600">
              {unconfirmed ? "⚠️ Some dishes' allergens aren't confirmed yet, so customers aren't told about them. " : "All confirmed. "}
              Tap a dish to change it; saving confirms every dish as shown.
            </p>
            <AllergenEditor initial={r.menu} save={saveSettingsAllergens.bind(null, restaurantId)} label="Confirm allergens" />
          </Card>
        )}

        {r.brand_voice && (
          <Card>
            <h2 className="text-lg font-bold">How you sound</h2>
            <p className="text-sm text-stone-700">{r.brand_voice}</p>
            <p className="text-sm text-stone-500">It keeps learning from your edits and the reasons you give when you skip a draft.</p>
          </Card>
        )}
      </div>
    </Frame>
  );
}
