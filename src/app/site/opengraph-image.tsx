import { ImageResponse } from "next/og";
import { site } from "@/content/site";

// The picture shown when dinerai.co.uk is shared (WhatsApp, LinkedIn, X...).
// Built at deploy time from the headline in src/content/site.ts.

export const alt = "DinerAI: your AI restaurant manager, on WhatsApp";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const grid =
    "linear-gradient(to right, rgba(237,239,232,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(237,239,232,0.06) 1px, transparent 1px)";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "#0b0c0a",
          backgroundImage: grid,
          backgroundSize: "48px 48px",
          color: "#edefe8",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg viewBox="0 0 28 28" width="56" height="56">
            <rect x="1" y="1" width="26" height="26" rx="7" fill="#c8f03c" />
            <path d="M8 14.5l4 4 8-9" fill="none" stroke="#0b0c0a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 600 }}>
            Diner<span style={{ color: "#c8f03c" }}>AI</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
          <span>{site.hero.headline[0]}</span>
          <span style={{ color: "#c8f03c" }}>{site.hero.headline[1]}</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 26, color: "#a3a99d" }}>
          <span>For UK restaurants, cafes and takeaways</span>
          <span style={{ color: "#ff7a3d" }}>·</span>
          <span>Approve on WhatsApp</span>
        </div>
      </div>
    ),
    size,
  );
}
