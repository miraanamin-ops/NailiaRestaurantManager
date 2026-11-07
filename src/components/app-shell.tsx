import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/app/site/_components/wordmark";
import { AccountMenu, BottomTabs, SideNav } from "./app-nav";

// The frame around every owner page (home, approvals, sales, customers, team,
// settings, activity; onboarding and login without the navigation): the dark
// DinerAI theme (.dai-app in globals.css), a sticky top bar, bottom tabs on a phone
// and a sidebar on a big screen.
export function AppShell({ children, nav = true }: { children: React.ReactNode; nav?: boolean }) {
  return (
    <div className="dai-app flex flex-1 flex-col">
      <header className="sticky top-0 z-30 border-b border-[#1e221b] bg-[#0b0c0a]/90 backdrop-blur-md">
        <div className={`mx-auto flex h-14 w-full items-center justify-between gap-4 px-4 sm:px-6 ${nav ? "" : "max-w-5xl"}`}>
          <Link href="/" aria-label="DinerAI home">
            <Wordmark />
          </Link>
          {nav && (
            <Suspense fallback={null}>
              <AccountMenu />
            </Suspense>
          )}
        </div>
      </header>
      {nav ? (
        <div className="flex flex-1">
          <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-60 shrink-0 border-r border-[#1e221b] px-3 py-5 lg:block">
            <Suspense fallback={null}>
              <SideNav />
            </Suspense>
          </aside>
          <div className="min-w-0 flex-1 pb-24 lg:pb-8">{children}</div>
          <Suspense fallback={null}>
            <BottomTabs />
          </Suspense>
        </div>
      ) : (
        <div className="flex-1">{children}</div>
      )}
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
