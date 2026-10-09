"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  token: string;
  restaurantName: string;
  brandColor: string;
  brandDark: string;
  firstName: string;
  reward: string;
  redeemedAt: string | null;
  expiresAt: string | null;
  serverNow: string;
  // Defaults suit the welcome reward; campaign offers override them.
  redeemPath?: string;
  label?: string;
  // Shown instead of the Redeem button when the offer isn't valid today.
  unavailable?: { title: string; message: string } | null;
};

const TZ = "Europe/London";

function formatClock(d: Date) {
  return d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatUsedAt(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-GB", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true });
  return `${date} at ${time}`;
}

export function RewardScreen(props: Props) {
  const [redeemedAt, setRedeemedAt] = useState(props.redeemedAt);
  const [expiresAt, setExpiresAt] = useState(props.expiresAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Use the server's clock (not the phone's) so changing the phone time can't extend the window.
  const offset = useRef(0);
  // Start from the server's time so the first render already shows the right
  // state (no green flash for a reward that has expired).
  const [now, setNow] = useState<Date>(() => new Date(props.serverNow));

  useEffect(() => {
    offset.current = new Date(props.serverNow).getTime() - Date.now();
    const tick = () => setNow(new Date(Date.now() + offset.current));
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [props.serverNow]);

  const state = !redeemedAt || !expiresAt ? "unused" : now >= new Date(expiresAt) ? "used" : "active";

  // Keep the screen awake while it's being shown to staff.
  useEffect(() => {
    if (state !== "active" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, [state]);

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(props.redeemPath ?? `/api/reward/${props.token}/redeem`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.message) {
        setError(data.message);
        return;
      }
      if (!res.ok) throw new Error();
      offset.current = new Date(data.serverNow).getTime() - Date.now();
      setRedeemedAt(data.redeemedAt);
      setExpiresAt(data.expiresAt);
    } catch {
      setError("Something went wrong. Please check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "used" && redeemedAt) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-stone-200 px-6 text-center text-stone-800">
        <p className="text-sm font-medium uppercase tracking-widest text-stone-500">{props.restaurantName}</p>
        <p className="mt-6 text-5xl">🚫</p>
        <h1 className="mt-4 text-3xl font-bold">Already used</h1>
        <p className="mt-3 text-lg">{props.reward}</p>
        <p className="mt-6 text-stone-600">Redeemed on {formatUsedAt(redeemedAt)}</p>
      </div>
    );
  }

  if (state === "active" && expiresAt) {
    const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.getTime()) / 1000));
    return (
      <div className="reward-live fixed inset-0 flex flex-col items-center justify-center overflow-hidden px-6 text-center text-white">
        <div className="reward-shine" aria-hidden="true" />
        <p className="relative text-sm font-semibold uppercase tracking-widest text-green-100">{props.restaurantName}</p>
        <div className="reward-ring relative mt-6 flex h-24 w-24 items-center justify-center rounded-full bg-white/20 text-5xl">✓</div>
        <p className="relative mt-6 text-lg">For {props.firstName}</p>
        <h1 className="relative mt-2 text-4xl font-extrabold leading-tight sm:text-5xl">{props.reward}</h1>
        <p className="relative mt-8 font-mono text-6xl font-bold tabular-nums tracking-tight" aria-label="Current time">
          {formatClock(now)}
        </p>
        <p className="relative mt-4 text-green-100">
          Valid for {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")} · live screen, not a screenshot
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-stone-100 text-stone-900">
      <header className="px-5 pb-8 pt-10 text-center text-white" style={{ background: props.brandDark }}>
        <div className="mx-auto mb-3 h-1 w-12 rounded-full" style={{ background: props.brandColor }} />
        <h1 className="text-2xl font-bold">{props.restaurantName}</h1>
      </header>
      <main className="mx-auto -mt-4 w-full max-w-md flex-1 px-4 pb-10">
        <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
          <p className="text-stone-600">
            Hi {props.firstName}, {props.label ?? "your welcome reward"}:
          </p>
          <p className="mt-3 text-3xl font-bold" style={{ color: props.brandColor }}>
            {props.reward} 🎁
          </p>
          {props.unavailable ? (
            <div className="mt-6 rounded-xl bg-stone-100 px-4 py-4 text-stone-700">
              <p className="font-semibold">{props.unavailable.title}</p>
              <p className="mt-1 text-sm">{props.unavailable.message}</p>
            </div>
          ) : (
            <>
              <p className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                Only tap <strong>Redeem now</strong> at the till, in front of staff. It works once and lasts 10 minutes.
              </p>
              {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
              <button
                type="button"
                onClick={redeem}
                disabled={busy}
                className="mt-6 w-full rounded-full px-6 py-4 text-lg font-semibold text-white shadow-sm disabled:opacity-60"
                style={{ background: props.brandColor }}
              >
                {busy ? "Redeeming…" : "Redeem now"}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
