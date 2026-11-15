import { ImageResponse } from "next/og";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { site } from "@/content/site";

const lockup = `data:image/png;base64,${readFileSync(join(process.cwd(), "public/brand/lockup-on-ink.png")).toString("base64")}`;

// The picture shown when dinerai.co.uk is shared (WhatsApp, LinkedIn, X...).
// Built at deploy time from the headline in src/content/site.ts.

export const alt = "DinerAI: your AI restaurant manager, in an app";
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
        {/* The brand kit's lock-up (on ink, like this picture). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={lockup} alt="DinerAI" width={320} height={80} />
        <div style={{ display: "flex", flexDirection: "column", fontSize: 72, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2 }}>
          <span>{site.hero.headline[0]}</span>
          <span style={{ color: "#c8f03c" }}>{site.hero.headline[1]}</span>
        </div>
        <div style={{ display: "flex", gap: 16, fontSize: 26, color: "#a3a99d" }}>
          <span>For UK restaurants, cafes and takeaways</span>
          <span style={{ color: "#ff7a3d" }}>·</span>
          <span>Approve in the app</span>
        </div>
      </div>
    ),
    size,
  );
}
