"use client";
import { useEffect, useRef, useState } from "react";
import { ExampleTag } from "./bits";

// The "done for you" counter: each number counts up once when it scrolls into view.
// The page is sent with the final numbers, so without JavaScript, or with reduced
// motion, they simply show.
export function CountUp({ items, label, example }: { items: readonly { value: number; label: string }[]; label: string; example: string }) {
  const [shown, setShown] = useState<number[]>(() => items.map((i) => i.value));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) return; // already on screen: leave the real numbers
    setShown(items.map(() => 0));
    let frame = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / 1400);
          const ease = 1 - Math.pow(1 - t, 3);
          setShown(items.map((i) => Math.round(i.value * ease)));
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [items]);

  return (
    <div ref={ref} className="rounded-2xl border border-ink-700 bg-ink-900/80 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.16em] text-fog">
          <span className="dai-pulse h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
          {label}
        </p>
        <ExampleTag>{example}</ExampleTag>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
        {items.map((item, i) => (
          <div key={item.label}>
            <dt className="sr-only">{item.label}</dt>
            <dd className="font-mono text-3xl font-medium tabular-nums text-mist sm:text-4xl">
              <span aria-hidden>{shown[i]}</span>
              <span className="sr-only">{item.value}</span>
            </dd>
            <dd aria-hidden className="mt-1 text-[13px] text-fog">
              {item.label}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

