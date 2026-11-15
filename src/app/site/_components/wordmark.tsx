// The DinerAI lock-up from the brand kit (Nov 2026): the cloche with the spark, then
// "diner" with "ai" in the accent. The kit's own SVGs (public/brand/), so it stays sharp
// at any size: chartreuse and mist on dark, ink and dark green on light.
export function Wordmark({ tone = "dark", className = "" }: { tone?: "dark" | "light"; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={tone === "dark" ? "/brand/lockup-on-ink.svg" : "/brand/lockup-on-paper.svg"}
      alt="DinerAI"
      width={115}
      height={28}
      className={`inline-block h-7 w-auto shrink-0 ${className}`}
    />
  );
}
