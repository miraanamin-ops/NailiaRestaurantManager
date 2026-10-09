import { Suspense } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import QRCode from "qrcode";
import { NotFoundCard } from "@/components/brand-shell";
import { getRestaurantBySlug } from "@/lib/signups";
import { baseUrlFrom } from "@/lib/supabase";

export const metadata: Metadata = { title: "Sign-up QR code", robots: { index: false } };

// A printable card with the QR code that leads to the sign-up page.
export default function QrPage({ params }: PageProps<"/r/[slug]/qr">) {
  return (
    <Suspense fallback={null}>
      <QrCard params={params} />
    </Suspense>
  );
}

async function QrCard({ params }: Pick<PageProps<"/r/[slug]/qr">, "params">) {
  const { slug } = await params;
  const r = await getRestaurantBySlug(slug);
  if (!r) return <NotFoundCard />;

  const url = `${baseUrlFrom(await headers())}/r/${r.slug}`;
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: r.brand_dark, light: "#ffffff" } });

  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-100 p-6 print:bg-white">
      <div className="w-full max-w-sm rounded-3xl bg-white p-8 text-center shadow-sm print:shadow-none" style={{ color: r.brand_dark }}>
        <p className="text-2xl font-bold">{r.name}</p>
        <div className="mx-auto my-3 h-1 w-12 rounded-full" style={{ background: r.brand_color }} />
        <p className="text-lg font-semibold">Scan to join & get</p>
        <p className="text-xl font-bold" style={{ color: r.brand_color }}>
          {r.signup_reward ?? "a welcome treat"} 🎁
        </p>
        <div className="mx-auto mt-6 w-64" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="mt-4 break-all text-xs text-stone-500">{url}</p>
        <p className="mt-6 text-xs text-stone-400 print:hidden">Tip: press Ctrl+P to print this card.</p>
      </div>
    </div>
  );
}
