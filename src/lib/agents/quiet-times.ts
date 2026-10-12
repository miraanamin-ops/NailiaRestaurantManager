// Busy and quiet times for Growth, worked out from the last 8 weeks of sales (the
// same figures Insights uses), so the owner never has to fill them in. Pure code
// over query_metrics, so it's unit-tested (tests/agents/growth.test.ts).
import { queryMetrics, type MetricsData, type MetricQueryInput } from "./insights-metrics";

const Q = (o: Pick<MetricQueryInput, "metric" | "period">): MetricQueryInput => ({ ...o, date: null, from: null, to: null, weekday: null, compare: "none", campaign: null });

// "Quietest days over the last 8 weeks (average net sales): Monday £1,422, ..." or null with too little data.
export function quietTimes(data: MetricsData): string | null {
  const days = queryMetrics(data, Q({ metric: "sales_by_weekday", period: "last_8_weeks" }), "w");
  const hours = queryMetrics(data, Q({ metric: "sales_by_hour", period: "last_8_weeks" }), "h");
  if (!days.available || days.rows.length < 3 || days.small_sample) return null;
  const byDay = [...days.rows].sort((a, b) => a.value - b.value);
  const name = (label: string) => label.replace(/ \(average of \d+\)$/, "");
  const parts = [
    `Quietest days over the last 8 weeks (average net sales): ${byDay.slice(0, 3).map((r) => `${name(r.label)} ${r.display}`).join(", ")}.`,
    `Busiest: ${byDay.slice(-2).reverse().map((r) => `${name(r.label)} ${r.display}`).join(", ")}.`,
  ];
  if (hours.available && hours.rows.length >= 3) {
    const open = hours.rows.filter((r) => r.value > 0);
    const quiet = [...open].sort((a, b) => a.value - b.value).slice(0, 2).map((r) => r.label.replace(" (average a day)", ""));
    const busy = [...open].sort((a, b) => b.value - a.value).slice(0, 2).map((r) => r.label.replace(" (average a day)", ""));
    parts.push(`Quietest hours while open: ${quiet.join(" and ")}. Busiest hours: ${busy.join(" and ")}.`);
  }
  return parts.join(" ");
}
