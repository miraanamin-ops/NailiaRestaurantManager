import { redirect } from "next/navigation";

// The old "Set up on WhatsApp" page: DinerAI runs in its app now, so this goes to
// "Get the DinerAI app" (same restaurant).
export default async function OldWhatsAppSetupPage({ searchParams }: PageProps<"/onboarding/whatsapp">) {
  const r = (await searchParams).r;
  const id = Array.isArray(r) ? r[0] : r;
  redirect(id ? `/onboarding/in?r=${encodeURIComponent(id)}` : "/onboarding/in");
}
