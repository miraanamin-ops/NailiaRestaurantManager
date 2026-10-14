"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { logOut } from "@/app/login/actions";

// The owner pages, keeping the restaurant being looked at (?r=) when switching page.
const PAGES = [
  { href: "/", label: "Dashboard" },
  { href: "/sales", label: "Sales" },
  { href: "/settings", label: "Settings" },
  { href: "/log", label: "Activity" },
];

export function AppNav() {
  const path = usePathname();
  const r = useSearchParams().get("r");
  return (
    <nav aria-label="Pages" className="flex items-center gap-1 overflow-x-auto text-[14px]">
      {PAGES.map((p) => {
        const here = p.href === "/" ? path === "/" : path.startsWith(p.href);
        return (
          <Link
            key={p.href}
            href={r ? `${p.href}?r=${r}` : p.href}
            aria-current={here ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 transition ${here ? "bg-[#1e221b] text-[#c8f03c]" : "text-[#a3a99d] hover:text-[#edefe8]"}`}
          >
            {p.label}
          </Link>
        );
      })}
      <form action={logOut}>
        <button className="whitespace-nowrap rounded-full px-3 py-1.5 text-[#a3a99d] hover:text-[#edefe8]">Log out</button>
      </form>
    </nav>
  );
}
