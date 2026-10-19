"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

// Shows that something is happening, on every page, without changing each form:
//   - a link to another page: a thin chartreuse bar runs across the top until it opens
//   - a form being sent: its button gets a spinner (styles in globals.css, .dai-busy)
//     and can't be pressed twice. A button with data-pending-text="Opening checkout…"
//     shows those words instead while it waits.
// Everything resets when the page changes, when the page updates around the form
// (e.g. an error appears), when coming back with the browser's Back button, or after 30 seconds.

const RESET_MS = 30_000;

function clearBusy() {
  document.querySelectorAll<HTMLElement>(".dai-busy").forEach((b) => {
    b.classList.remove("dai-busy");
    b.removeAttribute("aria-busy");
    b.style.removeProperty("--dai-fg");
  });
}

export function PendingUI() {
  const pathname = usePathname();
  const search = useSearchParams();
  const [loading, setLoading] = useState(false);

  // A new page (or new address) has arrived.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the navigation this bar was waiting for has finished
    setLoading(false);
    clearBusy();
  }, [pathname, search]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let watching: MutationObserver | null = null;
    const start = () => {
      setLoading(true);
      clearTimeout(timer);
      timer = setTimeout(() => {
        setLoading(false);
        clearBusy();
      }, RESET_MS);
    };

    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (!/^https?:$/.test(url.protocol)) return; // mailto:, tel:, whatsapp:
      if (url.origin === location.origin && url.pathname === location.pathname && url.search === location.search) return; // same page / #section
      start();
    };

    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      const button = (e.submitter as HTMLElement | null) ?? form.querySelector<HTMLElement>('button[type="submit"], button:not([type])');
      start();
      if (!button) return;
      // Only a class and a colour are added: the button's own content (which React
      // looks after) is never changed. The waiting words come from CSS (globals.css).
      button.style.setProperty("--dai-fg", getComputedStyle(button).color);
      button.classList.add("dai-busy");
      button.setAttribute("aria-busy", "true");
      // When the page changes around the form (an error message, the next step),
      // the wait is over. Changes inside the form (the "I'm human" box) don't count.
      watching?.disconnect();
      watching = new MutationObserver((records) => {
        if (records.some((r) => !form.contains(r.target))) {
          watching?.disconnect();
          setLoading(false);
          clearBusy();
        }
      });
      setTimeout(() => watching?.observe(document.body, { childList: true, subtree: true }), 250);
    };

    // Back from Stripe (or any page) restores this page as it was left: reset it.
    const onShow = () => {
      setLoading(false);
      clearBusy();
    };

    document.addEventListener("click", onClick);
    document.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
      watching?.disconnect();
      clearTimeout(timer);
    };
  }, []);

  return loading ? <div className="dai-progress" role="progressbar" aria-label="Loading" /> : null;
}
