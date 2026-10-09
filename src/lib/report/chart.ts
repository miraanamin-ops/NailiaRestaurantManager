import type { Daily } from "./types";

// Bar positions for the 14-day charts, shared by the web page and the PDF so
// both draw exactly the same picture. Week before = muted, last week = brand colour.
export const CHART = { width: 280, height: 80, gap: 2, labelSpace: 14 };
export const MUTED_BAR = "#a8a29e";

export function bars(daily: Daily) {
  const max = Math.max(1, ...daily.values);
  const plotH = CHART.height - CHART.labelSpace;
  const w = (CHART.width - CHART.gap * (daily.values.length - 1)) / daily.values.length;
  return daily.values.map((v, i) => {
    // Zero days still get a hairline so the 14-day rhythm stays visible.
    const h = v ? Math.max(3, (v / max) * plotH) : 1;
    return { x: i * (w + CHART.gap), y: plotH - h, w, h, value: v, day: daily.days[i], lastWeek: i >= 7 };
  });
}

export function weekTotals(daily: Daily) {
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  return { before: sum(daily.values.slice(0, 7)), now: sum(daily.values.slice(7)) };
}
