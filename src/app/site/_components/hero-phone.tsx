"use client";
import { useEffect, useRef, useState } from "react";
import type { site } from "@/content/site";

type Phone = (typeof site)["phone"];

// The hero's DinerAI app, drawn in code. One loop:
//   the 9am notification drops in → the Inbox opens on today's brief → a review
//   reply draft appears and is checked → the owner taps Approve → the card turns
//   into the receipt → back to the start.
// It starts with the brief already showing (so the page never looks empty), only
// runs while on screen, and stands still at the end under reduced motion.

// How long each step lasts before the next (ms). The index is the step.
const STEP_MS = [700, 1300, 1500, 900, 2600, 600, 700, 1600, 3200];
const LAST = STEP_MS.length;
//  0 empty · 1 notification · 2 brief · 3 loading · 4 draft · 5 tap Approve
//  6 approved · 7 receipt · 8 next chip · 9 (= LAST) hold, then loop
const FIRST_SHOWN = 2;

const TABS = ["Today", "Inbox", "Chat", "Reports", "More"];

export function HeroPhone({ phone, label }: { phone: Phone; label: string }) {
  const [step, setStep] = useState(FIRST_SHOWN);
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Run only while the phone is on screen and motion is allowed.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off switch to the finished screen
      setStep(LAST);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setRunning(e.isIntersecting && !document.hidden), { threshold: 0.25 });
    io.observe(el);
    const onVis = () => setRunning(!document.hidden && el.getBoundingClientRect().top < window.innerHeight);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const t = setTimeout(() => setStep((s) => (s >= LAST ? 0 : s + 1)), step >= LAST ? 2400 : STEP_MS[step]);
    return () => clearTimeout(t);
  }, [step, running]);

  const show = (n: number) => step >= n;
  const approved = show(6);

  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <p className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-fog">{label}</p>
      <div
        ref={ref}
        role="img"
        aria-label="Example of the DinerAI app. At 9am a notification says three things are ready to approve. The Inbox shows a drafted reply to a 5 star review, checked for tone, facts, compliance and money. The owner taps Approve and the reply is marked approved and ready to post on Google."
        className="relative rounded-[44px] border border-ink-700 bg-ink-900 p-[10px] shadow-[0_40px_120px_-30px_rgb(200_240_60_/_0.25)]"
      >
        <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[36px] bg-[#0e110c]">
          {/* Status bar */}
          <div className="flex items-center justify-between px-6 pt-3 font-mono text-[11px] text-mist/80">
            <span>{show(1) ? phone.time : "08:59"}</span>
            <span className="h-[18px] w-20 rounded-full bg-black" />
            <span>5G</span>
          </div>

          {/* The notification drops in, then goes once the Inbox is open. */}
          {step === 1 && (
            <div className="dai-in absolute inset-x-3 top-9 z-10 flex items-start gap-2.5 rounded-2xl bg-ink-700/95 px-3 py-2.5 shadow-lg ring-1 ring-white/10">
              <Logo />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-fog">
                  <span>{phone.contact}</span>
                  <span>now</span>
                </span>
                <span className="mt-0.5 block text-[12.5px] font-semibold text-mist">{phone.notification.title}</span>
                <span className="block text-[11.5px] text-mist/80">{phone.notification.body}</span>
              </span>
            </div>
          )}

          {/* Screen header */}
          <div className="mt-3 flex items-end justify-between px-4 pb-2">
            <span className="leading-tight">
              <span className="block font-mono text-[10px] uppercase tracking-wider text-fog">{phone.screen.eyebrow}</span>
              <span className="block text-[20px] font-bold tracking-tight text-mist">{phone.screen.title}</span>
            </span>
            {show(2) && <span className="rounded-full bg-signal/10 px-2 py-0.5 font-mono text-[10px] text-signal">{approved ? phone.screen.left : phone.screen.count}</span>}
          </div>

          {/* Cards: newest at the bottom, older ones slide up out of view. */}
          <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-3 pb-3 text-[13px] leading-snug">
            {show(2) && (
              <Card>
                <p className="font-semibold text-mist">{phone.brief.title}</p>
                <ol className="mt-1.5 space-y-0.5 text-mist/90">
                  {phone.brief.items.map((item, i) => (
                    <li key={item} className={`flex gap-1.5 ${approved && i === 0 ? "text-fog line-through" : ""}`}>
                      <span className="font-mono text-signal">{i + 1}.</span>
                      {item}
                    </li>
                  ))}
                </ol>
                <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[11.5px] text-fog">{phone.brief.done}</p>
              </Card>
            )}

            {step === 3 && <div className="dai-in h-24 animate-pulse rounded-2xl bg-ink-800/70" aria-hidden />}

            {show(4) && !approved && (
              <Card>
                <p className="font-mono text-[10px] uppercase tracking-wider text-fog">{phone.draft.label}</p>
                <p className="mt-1 text-[12px] italic text-fog">{phone.draft.review}</p>
                <p className="text-[10.5px] text-fog/80">
                  <span className="text-ember" aria-hidden>
                    ★★★★★
                  </span>{" "}
                  {phone.draft.reviewer}
                </p>
                <p className="mt-1.5 text-mist">{phone.draft.reply}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {phone.draft.checks.map((c, i) => (
                    <span
                      key={c}
                      className="dai-in inline-flex items-center gap-1 rounded-md bg-signal/10 px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-signal"
                      style={{ animationDelay: `${400 + i * 220}ms` }}
                    >
                      <svg viewBox="0 0 12 12" width="9" height="9" aria-hidden>
                        <path d="M2 6.5l2.5 2.5L10 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                  {phone.buttons.map((b, i) => (
                    <span
                      key={b}
                      className={`relative rounded-full py-1.5 text-center text-[12px] font-semibold ${i === 0 ? "bg-signal text-ink-900" : "bg-ink-700 text-mist"} ${i === 0 && step === 5 ? "dai-press" : ""}`}
                    >
                      {b}
                      {i === 0 && step === 5 && <span className="dai-in absolute -right-1 -top-1 h-5 w-5 rounded-full border-2 border-mist/80" />}
                    </span>
                  ))}
                </div>
              </Card>
            )}

            {show(7) && (
              <div className="dai-in mx-auto flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1.5 font-mono text-[10.5px] text-signal">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                  <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path className="dai-tick" d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {phone.receipt}
              </div>
            )}

            {show(8) && <p className="dai-in mx-auto font-mono text-[10px] uppercase tracking-wider text-fog">{phone.next} →</p>}
          </div>

          {/* Tab bar */}
          <div className="grid grid-cols-5 border-t border-white/5 px-2 pb-4 pt-2">
            {TABS.map((t) => (
              <span key={t} className={`flex flex-col items-center gap-1 text-[9.5px] ${t === "Inbox" ? "text-signal" : "text-fog"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${t === "Inbox" ? "bg-signal" : "bg-fog/40"}`} />
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-signal">
      <svg viewBox="0 0 28 28" width="16" height="16">
        <path d="M8 14.5l4 4 8-9" fill="none" stroke="#0b0c0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="dai-in relative rounded-2xl bg-ink-800 px-3 py-2.5 ring-1 ring-white/5">{children}</div>;
}
