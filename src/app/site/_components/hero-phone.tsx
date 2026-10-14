"use client";
import { useEffect, useRef, useState } from "react";
import type { site } from "@/content/site";

type Phone = (typeof site)["phone"];

// The hero's live WhatsApp conversation, drawn in code. One loop:
//   the 9am brief arrives → a review reply draft appears and is checked →
//   the owner taps Approve → the receipt ticks over → back to the start.
// It starts with the brief already showing (so the page never looks empty), only
// runs while on screen, and stands still at the end under reduced motion.

// How long each step lasts before the next (ms). The index is the step.
const STEP_MS = [700, 900, 1500, 900, 2600, 600, 500, 600, 1600, 3200];
const LAST = STEP_MS.length;
//  0 empty · 1 typing · 2 brief · 3 typing · 4 draft · 5 tap Approve · 6 owner bubble
//  7 read ticks · 8 receipt · 9 next chip · 10 (= LAST) hold, then loop
const FIRST_SHOWN = 2;

export function HeroPhone({ phone, label }: { phone: Phone; label: string }) {
  const [step, setStep] = useState(FIRST_SHOWN);
  const [running, setRunning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Run only while the phone is on screen and motion is allowed.
  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off switch to the finished conversation
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
  const typing = step === 1 || step === 3;

  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <p className="mb-3 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-fog">{label}</p>
      <div
        ref={ref}
        role="img"
        aria-label="Example WhatsApp conversation. At 9am DinerAI sends a brief with three things to approve. It shows a drafted reply to a 5 star review, checked for tone, facts, compliance and money. The owner taps Approve and the reply is marked approved and ready to post on Google."
        className="relative rounded-[44px] border border-ink-700 bg-ink-900 p-[10px] shadow-[0_40px_120px_-30px_rgb(200_240_60_/_0.25)]"
      >
        <div className="relative flex h-[560px] flex-col overflow-hidden rounded-[36px] bg-[#0e110c]">
          {/* Status bar and chat header */}
          <div className="flex items-center justify-between px-6 pt-3 font-mono text-[11px] text-mist/80">
            <span>{show(FIRST_SHOWN) ? phone.time : "08:59"}</span>
            <span className="h-[18px] w-20 rounded-full bg-black" />
            <span>5G</span>
          </div>
          <div className="mt-2 flex items-center gap-3 border-b border-white/5 px-4 pb-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-signal">
              <svg viewBox="0 0 28 28" width="18" height="18">
                <path d="M8 14.5l4 4 8-9" fill="none" stroke="#0b0c0a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="leading-tight">
              <span className="block text-[14px] font-semibold text-mist">{phone.contact}</span>
              <span className="block text-[11px] text-fog">{typing ? "typing…" : phone.status}</span>
            </span>
          </div>

          {/* Messages: newest at the bottom, older ones slide up out of view. */}
          <div className="flex flex-1 flex-col justify-end gap-2 overflow-hidden px-3 pb-4 text-[13px] leading-snug">
            {show(2) && (
              <Bubble>
                <p className="font-semibold text-mist">{phone.brief.title}</p>
                <ol className="mt-1.5 space-y-0.5 text-mist/90">
                  {phone.brief.items.map((item, i) => (
                    <li key={item} className="flex gap-1.5">
                      <span className="font-mono text-signal">{i + 1}.</span>
                      {item}
                    </li>
                  ))}
                </ol>
                <p className="mt-1.5 border-t border-white/5 pt-1.5 text-[11.5px] text-fog">{phone.brief.done}</p>
                <Time>{phone.time}</Time>
              </Bubble>
            )}

            {show(4) && (
              <div className="dai-in">
                <Bubble>
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
                  <Time>09:01</Time>
                </Bubble>
                <div className="mt-1 grid gap-1">
                  {phone.buttons.map((b, i) => (
                    <span
                      key={b}
                      className={`relative rounded-xl bg-ink-800 py-2 text-center text-[13px] font-medium text-[#7fd4ff] ${i === 0 && step === 5 ? "dai-press" : ""}`}
                    >
                      {b}
                      {i === 0 && step === 5 && (
                        <span className="dai-in absolute right-8 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full border-2 border-signal/80" />
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {show(6) && (
              <div className="dai-in ml-auto max-w-[70%] rounded-2xl rounded-tr-sm bg-[#263213] px-3 py-1.5 text-mist">
                {phone.approved}
                <span className="ml-2 inline-flex translate-y-[1px] items-center gap-1 font-mono text-[10px] text-fog">
                  09:02
                  <svg viewBox="0 0 18 12" width="16" height="11" aria-hidden className={show(7) ? "text-signal" : "text-fog"}>
                    <path d="M1 6.5l3 3L10 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                    {show(7) && <path className="dai-tick" d="M7 9.5L13 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
                  </svg>
                </span>
              </div>
            )}

            {show(8) && (
              <div className="dai-in mx-auto flex items-center gap-2 rounded-full border border-signal/30 bg-signal/10 px-3 py-1.5 font-mono text-[10.5px] text-signal">
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                  <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" />
                  <path className="dai-tick" d="M4.5 8.2l2.3 2.3 4.7-4.9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                {phone.receipt}
              </div>
            )}

            {show(9) && <p className="dai-in mx-auto font-mono text-[10px] uppercase tracking-wider text-fog">{phone.next} →</p>}

            {typing && (
              <div className="dai-in dai-typing flex w-14 items-center justify-center gap-1 rounded-2xl rounded-tl-sm bg-ink-800 py-3">
                <span className="h-1.5 w-1.5 rounded-full bg-fog" />
                <span className="h-1.5 w-1.5 rounded-full bg-fog" />
                <span className="h-1.5 w-1.5 rounded-full bg-fog" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ children }: { children: React.ReactNode }) {
  return <div className="dai-in relative max-w-[92%] rounded-2xl rounded-tl-sm bg-ink-800 px-3 py-2">{children}</div>;
}

function Time({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block text-right font-mono text-[9.5px] text-fog/80">{children}</span>;
}
