import { Suspense } from "react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import * as engine from "@/lib/onboarding/engine";
import { placesAvailable } from "@/lib/onboarding/places";
import { formatPrice, menuItemCount } from "@/lib/onboarding/profile-data";
import { finishSetup, pickGoogle, pickVoice, redraftVoices, saveAllergens, saveMenu, saveReward, searchGoogle, skipStep, startMenuAgain } from "../actions";
import { linkCodeFor, loadOnboarding } from "../load";
import { button, Card, Frame, input, LinkWhatsApp, Progress, secondary, SwitchToWhatsApp } from "../ui";
import { AllergenEditor, MenuEditor, MenuPhotos } from "./editors";
import type { StepId } from "@/lib/onboarding/steps";

export const metadata: Metadata = { title: "Set up Naila", robots: { index: false, follow: false } };
// Reading menu photos and writing voices can take a minute or two.
export const maxDuration = 300;

type S = Awaited<ReturnType<typeof loadOnboarding>>["s"];

// The web wizard: one step per screen, always the first one not done yet.
// Everything is saved as it goes, so the owner can leave, come back, or switch to WhatsApp.
export default function SetupPage({ searchParams }: PageProps<"/onboarding/setup">) {
  return (
    <Suspense fallback={<div className="min-h-dvh bg-stone-100" />}>
      <Setup searchParams={searchParams} />
    </Suspense>
  );
}

async function Setup({ searchParams }: Pick<PageProps<"/onboarding/setup">, "searchParams">) {
  const { s, restaurantId } = await loadOnboarding(searchParams, "/onboarding/setup");
  if (s.onboarding.completed_at || !s.step) redirect(`/onboarding?r=${restaurantId}`);

  return (
    <Frame>
      <Progress step={s.step} done={s.done} total={s.total} />
      <Step s={s} restaurantId={restaurantId} />
      <SwitchToWhatsApp restaurantId={restaurantId} />
    </Frame>
  );
}

function Step({ s, restaurantId }: { s: S; restaurantId: string }) {
  switch (s.step!) {
    case "google":
      return (
        <Slow message="Looking for you on Google… 🔎">
          <GoogleStep s={s} restaurantId={restaurantId} />
        </Slow>
      );
    case "menu":
      return <MenuStep s={s} restaurantId={restaurantId} />;
    case "allergens":
      return (
        <Slow message="Checking your dishes for likely allergens… ⏳">
          <AllergenStep restaurantId={restaurantId} />
        </Slow>
      );
    case "voice":
      return (
        <Slow message="Reading your website and writing three ways you could sound… ✍️ (up to a minute)">
          <VoiceStep s={s} restaurantId={restaurantId} />
        </Slow>
      );
    case "reward":
      return <RewardStep restaurantId={restaurantId} />;
    case "finish":
      return <FinishStep s={s} restaurantId={restaurantId} />;
  }
}

function Slow({ message, children }: { message: string; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <Card>
          <p className="animate-pulse py-6 text-center text-stone-600">{message}</p>
        </Card>
      }
    >
      {children}
    </Suspense>
  );
}

function Hidden({ restaurantId, step }: { restaurantId: string; step?: StepId }) {
  return (
    <>
      <input type="hidden" name="r" value={restaurantId} />
      {step && <input type="hidden" name="step" value={step} />}
    </>
  );
}

function Skip({ restaurantId, step, label = "Skip for now" }: { restaurantId: string; step: StepId; label?: string }) {
  return (
    <form action={skipStep}>
      <Hidden restaurantId={restaurantId} step={step} />
      <button className="w-full py-2 text-center text-sm font-medium text-stone-500 underline">{label}</button>
    </form>
  );
}

// ---------- 1. Google ----------

async function GoogleStep({ s, restaurantId }: { s: S; restaurantId: string }) {
  if (!placesAvailable()) {
    return (
      <Card>
        <h1 className="text-xl font-bold">Find you on Google</h1>
        <p className="text-stone-600">Google search isn&apos;t switched on yet, so let&apos;s skip this. You can add your address and opening hours later in Settings.</p>
        <Skip restaurantId={restaurantId} step="google" label="Continue" />
      </Card>
    );
  }
  // Search once by name, straight away: never ask for what we can find.
  const candidates = s.onboarding.data.google?.candidates ?? (await engine.findOnGoogle(restaurantId)).candidates;
  return (
    <Card>
      <h1 className="text-xl font-bold">{candidates.length ? "Is this you?" : `We couldn't find ${s.restaurant.name} on Google`}</h1>
      {candidates.length > 0 && <p className="text-stone-600">We&apos;ll copy your address, opening hours, phone number, rating and photos.</p>}
      {candidates.map((c) => (
        <form key={c.id} action={pickGoogle}>
          <Hidden restaurantId={restaurantId} />
          <input type="hidden" name="place" value={c.id} />
          <button className="w-full rounded-xl p-4 text-left ring-1 ring-stone-300 active:bg-stone-50">
            <span className="block font-semibold">{c.name}</span>
            <span className="block text-sm text-stone-600">{c.address}</span>
            <span className="mt-2 block text-sm font-semibold text-emerald-700">Yes, that&apos;s us →</span>
          </button>
        </form>
      ))}
      <form action={searchGoogle} className="space-y-2 pt-2">
        <Hidden restaurantId={restaurantId} />
        <label className="block text-sm font-medium">{candidates.length ? "Not you? Add your postcode or area" : "Add your postcode or area and we'll look again"}</label>
        <div className="flex gap-2">
          <input name="area" required className={`${input} flex-1`} placeholder="e.g. E1 6QL or Ilford" />
          <button className="shrink-0 rounded-xl bg-stone-900 px-4 font-semibold text-white">Search</button>
        </div>
      </form>
      <Skip restaurantId={restaurantId} step="google" />
    </Card>
  );
}

// ---------- 2. Menu ----------

async function MenuStep({ s, restaurantId }: { s: S; restaurantId: string }) {
  const draft = s.onboarding.data.menu?.draft;
  if (draft && menuItemCount(draft)) {
    return (
      <Card>
        <h1 className="text-xl font-bold">Check your menu</h1>
        <p className="text-stone-600">
          We read {menuItemCount(draft)} dishes. Fix anything we got wrong: tap a name or price to change it, ✕ to remove.
        </p>
        <MenuEditor initial={draft} save={saveMenu.bind(null, restaurantId)} />
        <form action={startMenuAgain}>
          <Hidden restaurantId={restaurantId} />
          <button className="w-full py-2 text-center text-sm font-medium text-stone-500 underline">Start again with new photos</button>
        </form>
      </Card>
    );
  }
  const photos = await engine.menuPhotos(restaurantId);
  return (
    <Card>
      <h1 className="text-xl font-bold">Your menu</h1>
      <p className="text-stone-600">Take a photo of each page of your menu (or choose them from your phone). We&apos;ll read the dishes and prices for you to check.</p>
      <MenuPhotos restaurantId={restaurantId} initialCount={photos.length} />
      <Skip restaurantId={restaurantId} step="menu" />
    </Card>
  );
}

// ---------- 3. Allergens ----------

async function AllergenStep({ restaurantId }: { restaurantId: string }) {
  const suggested = await engine.suggestMenuAllergens(restaurantId);
  return (
    <Card>
      <h1 className="text-xl font-bold">Allergens</h1>
      <p className="text-stone-600">
        Our best guess at the 14 main allergens in each dish. Tap a dish to change it.{" "}
        <b>Please check with your kitchen.</b> Customers are never told about allergens until you confirm them.
      </p>
      <AllergenEditor initial={suggested} save={saveAllergens.bind(null, restaurantId)} />
      <Skip restaurantId={restaurantId} step="allergens" label="Skip (nothing about allergens goes to customers)" />
    </Card>
  );
}

// ---------- 4. Voice ----------

async function VoiceStep({ s, restaurantId }: { s: S; restaurantId: string }) {
  const samples = s.onboarding.data.voice?.samples ?? (await engine.draftVoiceOptions(restaurantId)).samples;
  return (
    <Card>
      <h1 className="text-xl font-bold">Which sounds most like you?</h1>
      <p className="text-stone-600">Three ways your messages to customers could sound{s.restaurant.website ? ", based on your website" : ""}. Pick the closest; it&apos;ll keep learning from your edits.</p>
      {samples.map((v, n) => (
        <form key={n} action={pickVoice}>
          <Hidden restaurantId={restaurantId} />
          <input type="hidden" name="n" value={n} />
          <button className="w-full rounded-xl p-4 text-left ring-1 ring-stone-300 active:bg-stone-50">
            <span className="block font-semibold">{v.tone}</span>
            <span className="mt-1 block text-stone-700">&ldquo;{v.sample}&rdquo;</span>
            <span className="mt-2 block text-sm font-semibold text-emerald-700">This sounds like us →</span>
          </button>
        </form>
      ))}
      <details className="rounded-xl bg-stone-50 p-4">
        <summary className="cursor-pointer font-medium">None quite right? Paste some Instagram captions</summary>
        <form action={redraftVoices} className="mt-3 space-y-2">
          <Hidden restaurantId={restaurantId} />
          <textarea name="captions" required rows={5} className={input} placeholder="Paste 2 or 3 captions, with an empty line between each" />
          <button className={secondary}>Try again in my style</button>
        </form>
      </details>
      <Skip restaurantId={restaurantId} step="voice" />
    </Card>
  );
}

// ---------- 5. Reward ----------

async function RewardStep({ restaurantId }: { restaurantId: string }) {
  const d = await engine.rewardDefaults(restaurantId);
  return (
    <Card>
      <h1 className="text-xl font-bold">Sign-up reward</h1>
      <p className="text-stone-600">Customers scan your QR code to join your list. This is what they get for joining, and the biggest discount Naila will ever suggest.</p>
      <form action={saveReward} className="space-y-4">
        <Hidden restaurantId={restaurantId} />
        <label className="block">
          <span className="text-sm font-medium">New customers get</span>
          <input name="reward" defaultValue={d.reward} maxLength={100} className={`mt-1 ${input}`} />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Biggest discount</span>
          <select name="cap" defaultValue={String(d.cap)} className={`mt-1 ${input} bg-white`}>
            {[10, 15, 20, 25, 30].map((c) => (
              <option key={c} value={c}>
                {c}%
              </option>
            ))}
          </select>
        </label>
        <button className={button}>Looks good</button>
      </form>
    </Card>
  );
}

// ---------- 6. Finish ----------

async function FinishStep({ s, restaurantId }: { s: S; restaurantId: string }) {
  const r = s.restaurant;
  if (!s.whatsappLinked) {
    return (
      <Card>
        <h1 className="text-xl font-bold">Last step: link your WhatsApp</h1>
        <p className="text-stone-600">Naila works on WhatsApp: your drafts, approvals and morning brief arrive there.</p>
        <LinkWhatsApp code={await linkCodeFor(restaurantId, s.onboarding)} expected={s.onboarding.pending_whatsapp} />
        <a href={`/onboarding/setup?r=${restaurantId}`} className={secondary}>
          I&apos;ve sent it, carry on
        </a>
      </Card>
    );
  }
  const items = (r.menu ?? []).flatMap((c) => c.items);
  return (
    <Card>
      <h1 className="text-xl font-bold">Ready to go</h1>
      <ul className="space-y-2 text-stone-800">
        {engine.summaryLines(r, s.onboarding).map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {items.length > 0 && (
        <p className="text-sm text-stone-500">
          e.g. {items.slice(0, 3).map((i) => `${i.name} ${i.price ? formatPrice(i.price) : ""}`.trim()).join(" · ")}
        </p>
      )}
      <form action={finishSetup}>
        <Hidden restaurantId={restaurantId} />
        <button className={button}>Finish and get my QR codes</button>
      </form>
    </Card>
  );
}
