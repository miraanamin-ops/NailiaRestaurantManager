"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// After a message is sent, reloads the conversation every 3 seconds for a minute,
// so the demo restaurant's answer shows up on its own.
export function AutoRefresh({ since }: { since: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() - since > 60_000) clearInterval(timer);
      else router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [router, since]);
  return null;
}
