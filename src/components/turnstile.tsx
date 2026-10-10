"use client";
import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile, the "I'm human" check. Drawn explicitly once this box is on
// screen: the page streams its form in after the first load, so Cloudflare's
// automatic scan (which runs once, when its script loads) can miss it.
// Cloudflare adds a hidden "cf-turnstile-response" field to the surrounding form.
// If it can't show the check, Cloudflare's error code is shown, so it can be fixed.

type TurnstileApi = { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

function loadScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise<TurnstileApi>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
    if (!script) {
      script = document.createElement("script");
      script.src = SRC;
      script.async = true;
      document.head.appendChild(script);
    }
    const done = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("script-loaded-without-turnstile")));
    script.addEventListener("load", done);
    script.addEventListener("error", () => reject(new Error("script-blocked")));
    // Already loaded by an earlier visit to the page.
    if (window.turnstile) done();
  });
}

export function Turnstile({ siteKey }: { siteKey: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let id: string | null = null;
    let cancelled = false;
    loadScript()
      .then((t) => {
        if (cancelled || !box.current) return;
        id = t.render(box.current, {
          sitekey: siteKey,
          theme: "light",
          size: "flexible",
          "error-callback": (code: string) => {
            console.error("Turnstile error", code);
            setProblem(String(code || "unknown"));
            return true;
          },
        });
      })
      .catch((err: Error) => {
        console.error("Turnstile failed to load", err);
        setProblem(err.message);
      });
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
    };
  }, [siteKey]);
  return (
    <div>
      <div ref={box} className="min-h-[65px]" />
      {problem && (
        <p className="mt-1 text-xs text-red-700">
          The &quot;I&apos;m human&quot; check couldn&apos;t load (code: {problem}). Try reloading the page, or turning off any ad blocker.
        </p>
      )}
    </div>
  );
}
