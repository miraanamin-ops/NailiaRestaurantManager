import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/app/site/_components/wordmark";
import { AppNav } from "./app-nav";

// The frame around every owner page (dashboard, settings, sales, log, onboarding,
// login): the dark DinerAI theme (.dai-app in globals.css) and a header with the
// wordmark and, once set up, the main pages.
export function AppShell({ children, nav = true }: { children: React.ReactNode; nav?: boolean }) {
  return (
    <div className="dai-app flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-[#1e221b] bg-[#0b0c0a]/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/" aria-label="DinerAI dashboard">
            <Wordmark />
          </Link>
          {nav && (
            <Suspense fallback={null}>
              <AppNav />
            </Suspense>
          )}
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}

// What shows while a page's data loads: an outline of a page, gently shimmering.
export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading" className="mx-auto w-full max-w-md space-y-4 px-4 py-8">
      <div className="dai-skeleton h-8 w-2/3" />
      <div className="dai-skeleton h-4 w-full" />
      <div className="dai-skeleton h-40 w-full" />
      <div className="dai-skeleton h-12 w-full" />
    </div>
  );
}
