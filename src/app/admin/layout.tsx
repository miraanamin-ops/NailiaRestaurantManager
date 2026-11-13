import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Wordmark } from "@/app/site/_components/wordmark";
import { currentFounder } from "@/lib/founder/access";

// The founder dashboard (/admin, step 52): only FOUNDER_EMAIL gets in
// (lib/founder/access.ts, checked on every page and action; anyone else gets Not
// found, and doesn't even see this header). Built for a laptop, readable on a phone.
export const metadata: Metadata = { title: "DinerAI", robots: { index: false, follow: false } };

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/clients", label: "Clients" },
  { href: "/admin/costs", label: "Costs" },
];

async function Header() {
  await connection();
  if (!(await currentFounder())) return null;
  return (
    <header className="sticky top-0 z-30 border-b border-[#1e221b] bg-[#0b0c0a]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link href="/admin" aria-label="Founder dashboard" className="flex items-center gap-2">
          <Wordmark />
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[#ff7a3d]">Founder</span>
        </Link>
        <nav className="flex gap-1 text-[14px]">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className="rounded-full px-3 py-1.5 text-[#a3a99d] transition hover:bg-[#1e221b] hover:text-[#edefe8]">
              {t.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dai-app flex min-h-dvh flex-1 flex-col bg-[#0b0c0a]">
      <Suspense fallback={<div className="h-14 border-b border-[#1e221b]" />}>
        <Header />
      </Suspense>
      <div className="flex-1">{children}</div>
    </div>
  );
}
