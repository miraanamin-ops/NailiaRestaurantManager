import { Suspense } from "react";
import { redirect } from "next/navigation";

// The old "Set up on WhatsApp" page: DinerAI runs in its app now, so this goes to
// "Get the DinerAI app" (same restaurant). The redirect reads the address, so it
// sits inside Suspense (pages are prerendered).
export default function OldWhatsAppSetupPage({ searchParams }: PageProps<"/onboarding/whatsapp">) {
  return (
    <Suspense fallback={null}>
      <GoToTheApp searchParams={searchParams} />
    </Suspense>
  );
}

async function GoToTheApp({ searchParams }: Pick<PageProps<"/onboarding/whatsapp">, "searchParams">) {
  const r = (await searchParams).r;
  const id = Array.isArray(r) ? r[0] : r;
  redirect(id ? `/onboarding/in?r=${encodeURIComponent(id)}` : "/onboarding/in");
  return null;
}
