import { PageSkeleton } from "@/components/app-shell";
import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { appStoreLinks } from "@/lib/app-stores";
import { loadOnboarding } from "@/app/onboarding/load";
import { button, Card, Frame, secondary } from "@/app/onboarding/ui";

export const metadata: Metadata = { title: "Get the DinerAI app", robots: { index: false, follow: false } };

// "Get the app", from the web chat's header, the dashboard's setup list and the
// end of setup. DinerAI runs in its phone app: the brief, alerts, approvals and
// chat all arrive there. Same login and the same progress as the web.
export default function GetTheAppPage({ searchParams }: PageProps<"/onboarding/in">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <GetTheApp searchParams={searchParams} />
    </Suspense>
  );
}

async function GetTheApp({ searchParams }: Pick<PageProps<"/onboarding/in">, "searchParams">) {
  const { s, restaurantId } = await loadOnboarding(searchParams, "/onboarding/in");
  const r = s.restaurant;
  const firstName = r.owner_name?.trim().split(/\s+/)[0];
  const stores = appStoreLinks();

  return (
    <Frame>
      <Link href={`/onboarding/chat?r=${restaurantId}`} className="text-sm font-medium text-stone-600 underline-offset-4 hover:underline">
        ← Back to the chat
      </Link>
      <h1 className="mt-3 text-3xl font-bold tracking-tight">Get the DinerAI app</h1>
      <p className="mt-2 text-stone-600">
        {firstName ? `${firstName}, your` : "Your"} morning brief, alerts and approvals for {r.name} come in the DinerAI app, with a notification when
        something needs you. You can carry on setting up there too, right where you are.
      </p>

      <div className="mt-6 space-y-4">
        <Card>
          <ol className="space-y-3 text-sm text-stone-700">
            <li>
              <b>1.</b> {stores.length ? "Download DinerAI on your phone:" : "DinerAI is on its way to the App Store and Google Play. Once it's there, search for DinerAI on your phone and install it."}
            </li>
            {stores.length > 0 && (
              <li className="flex flex-wrap gap-2">
                {stores.map((st, i) => (
                  <a key={st.label} href={st.href} className={i === 0 ? button : secondary}>
                    {st.label}
                  </a>
                ))}
              </li>
            )}
            <li>
              <b>2.</b> Log in with the same email and password you use here.
            </li>
            <li>
              <b>3.</b> Allow notifications, so your brief and urgent alerts reach you.
            </li>
          </ol>
        </Card>
      </div>
      <p className="mt-6 text-center text-sm text-stone-500">Same login and same progress on the web and in the app: switch whenever you like.</p>
    </Frame>
  );
}
