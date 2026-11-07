"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logOut } from "@/app/login/actions";
import { Icon, type IconName } from "./icons";

// The owner pages' navigation: bottom tabs on a phone, a sidebar on a big screen,
// and the account menu in the top bar. Keeps the restaurant being looked at (?r=).

type NavItem = { href: string; label: string; icon: IconName; also?: string[] };

// Phone: the four things owners do most, and More for the rest.
const TABS: NavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/approvals", label: "Approvals", icon: "approvals" },
  { href: "/sales", label: "Sales", icon: "sales" },
  { href: "/customers", label: "Customers", icon: "customers" },
  { href: "/more", label: "More", icon: "more", also: ["/reviews", "/staff", "/log", "/settings", "/report", "/rota", "/builder"] },
];

// Big screen: everything.
const SIDEBAR: NavItem[] = [
  { href: "/", label: "Home", icon: "home" },
  { href: "/approvals", label: "Approvals", icon: "approvals" },
  { href: "/reviews", label: "Reviews", icon: "star" },
  { href: "/customers", label: "Customers", icon: "customers" },
  { href: "/sales", label: "Sales", icon: "sales" },
  { href: "/staff", label: "Team", icon: "team", also: ["/rota"] },
  { href: "/log", label: "Activity", icon: "activity" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

function isHere(path: string, item: NavItem) {
  const match = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  return match(item.href) || (item.also ?? []).some(match);
}

function useR() {
  return useSearchParams().get("r");
}
const withR = (href: string, r: string | null) => (r ? `${href}?r=${r}` : href);

export function BottomTabs() {
  const path = usePathname();
  const r = useR();
  return (
    <nav
      aria-label="Pages"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#1e221b] bg-[#0b0c0a]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-1 py-1.5">
        {TABS.map((t) => {
          const here = isHere(path, t);
          return (
            <Link
              key={t.href}
              href={withR(t.href, r)}
              aria-current={here ? "page" : undefined}
              className={`flex min-h-[48px] min-w-[60px] flex-col items-center justify-center gap-1 rounded-xl px-2 ${here ? "text-[#c8f03c]" : "text-[#a3a99d] hover:text-[#edefe8]"}`}
            >
              <Icon name={t.icon} className="h-[21px] w-[21px]" strokeWidth={here ? 2.2 : 1.8} />
              <span className="text-[11px] font-medium leading-none">{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

export function SideNav() {
  const path = usePathname();
  const r = useR();
  return (
    <nav aria-label="Pages" className="space-y-1">
      {SIDEBAR.map((t) => {
        const here = isHere(path, t);
        return (
          <Link
            key={t.href}
            href={withR(t.href, r)}
            aria-current={here ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] transition ${here ? "bg-[#1e221b] font-medium text-[#c8f03c]" : "text-[#a3a99d] hover:bg-[#121410] hover:text-[#edefe8]"}`}
          >
            <Icon name={t.icon} className="h-[19px] w-[19px]" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

// The round button top right: settings, activity and log out.
export function AccountMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const r = useR();
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[#171a14] text-[#edefe8] ring-1 ring-[#2c3127] hover:ring-[#3a4034]"
      >
        <Icon name="user" className="h-[17px] w-[17px]" />
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-48 overflow-hidden rounded-2xl bg-[#171a14] py-1 shadow-2xl ring-1 ring-[#2c3127]">
          <Link href={withR("/settings", r)} className="flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-[#edefe8] hover:bg-[#1e221b]" onClick={() => setOpen(false)}>
            <Icon name="settings" className="h-4 w-4 text-[#a3a99d]" /> Settings
          </Link>
          <Link href={withR("/log", r)} className="flex items-center gap-2.5 px-4 py-2.5 text-[14px] text-[#edefe8] hover:bg-[#1e221b]" onClick={() => setOpen(false)}>
            <Icon name="activity" className="h-4 w-4 text-[#a3a99d]" /> Activity
          </Link>
          <form action={logOut}>
            <button className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-[14px] text-[#ff8a6e] hover:bg-[#1e221b]">
              <Icon name="logout" className="h-4 w-4" /> Log out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
