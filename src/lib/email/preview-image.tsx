import { ImageResponse } from "next/og";
import type { EmailContent } from "./content";

// A picture of an email, sent to the owner on WhatsApp before they approve it.
// Drawn from the same EmailContent as the real email (templates.tsx), at phone
// width, so what they approve is what customers see. (The image library only
// understands a subset of CSS, so this is a close copy of the layout, not a
// screenshot: every box with more than one child needs display: flex.)

const WIDTH = 600;
const MUTED = "#78716c";

// Rough height, so the picture isn't cut off or full of empty space.
function estimateHeight(c: EmailContent) {
  const lines = (text: string, size: number) => Math.max(1, Math.ceil((text.length * size * 0.55) / (WIDTH - 72)));
  let h = 40 + 120 + (c.brand.logoUrl ? 60 : 0) + (c.brand.tagline ? 20 : 0); // margins + header
  if (c.banner) h += 30;
  h += lines(c.heading, 26) * 34 + 16;
  for (const p of c.paragraphs) h += lines(p, 17) * 26 + 14;
  if (c.offer) h += 110;
  if (c.stars) h += 90;
  h += c.buttons.length * 66;
  if (c.note) h += lines(c.note, 13) * 19 + 20;
  if (c.signOff) h += c.signOff.split("\n").length * 26 + 20;
  h += 110; // footer
  return Math.min(2400, Math.max(600, Math.round(h)));
}

export function emailPreviewImage(c: EmailContent) {
  const b = c.brand;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#f5f5f4", padding: 20 }}>
        <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#ffffff", borderRadius: 18, overflow: "hidden" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", backgroundColor: b.dark, padding: "26px 20px" }}>
            {b.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- drawn into a PNG, not a web page
              <img src={b.logoUrl} alt="" height={56} style={{ height: 56, marginBottom: 10, borderRadius: 8 }} />
            )}
            <div style={{ display: "flex", color: b.onDark, fontSize: 26, fontWeight: 700 }}>{b.name}</div>
            {b.tagline && <div style={{ display: "flex", color: b.onDark, opacity: 0.75, fontSize: 14, marginTop: 4 }}>{b.tagline}</div>}
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: "28px 36px 8px" }}>
            {c.banner && <div style={{ display: "flex", color: b.color, fontSize: 15, fontWeight: 700, marginBottom: 8 }}>{c.banner.toUpperCase()}</div>}
            <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#1c1917", marginBottom: 16, lineHeight: 1.3 }}>{c.heading}</div>
            {c.paragraphs.map((p, i) => (
              <div key={i} style={{ display: "flex", fontSize: 17, lineHeight: 1.5, color: "#1c1917", marginBottom: 14 }}>
                {p}
              </div>
            ))}
            {c.offer && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", border: `3px dashed ${b.color}`, borderRadius: 12, padding: "18px 12px", margin: "8px 0 20px" }}>
                <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: b.color, textAlign: "center" }}>{c.offer.title}</div>
                <div style={{ display: "flex", fontSize: 14, color: MUTED, marginTop: 6 }}>{c.offer.detail}</div>
              </div>
            )}
            {c.stars && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", margin: "4px 0 18px" }}>
                <div style={{ display: "flex", fontSize: 14, color: MUTED, marginBottom: 8 }}>Tap to rate your visit (private, to the owner):</div>
                <div style={{ display: "flex", fontSize: 36 }}>⭐ ⭐ ⭐ ⭐ ⭐</div>
              </div>
            )}
            {c.buttons.map((btn) => (
              <div key={btn.url} style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    borderRadius: 999,
                    padding: "14px 30px",
                    fontSize: 18,
                    fontWeight: 700,
                    ...(btn.style === "primary"
                      ? { backgroundColor: b.color, color: b.onColor }
                      : { backgroundColor: "#ffffff", color: b.dark, border: `2px solid ${b.dark}` }),
                  }}
                >
                  {btn.label}
                </div>
              </div>
            ))}
            {c.note && <div style={{ display: "flex", fontSize: 13, color: MUTED, lineHeight: 1.45, margin: "8px 0 16px" }}>{c.note}</div>}
            {c.signOff && (
              <div style={{ display: "flex", flexDirection: "column", fontSize: 17, color: "#1c1917", margin: "8px 0 20px" }}>
                {c.signOff.split("\n").map((line) => (
                  <div key={line} style={{ display: "flex" }}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", padding: "16px 36px 24px", borderTop: "1px solid #e7e5e4", fontSize: 12, color: MUTED, lineHeight: 1.5 }}>
            <div style={{ display: "flex" }}>{`${b.name}${b.address ? ` · ${b.address}` : ""}`}</div>
            <div style={{ display: "flex" }}>{c.footer.reason}</div>
            {(c.footer.unsubscribeUrl || c.footer.ownerCopy) && (
              <div style={{ display: "flex", textDecoration: "underline" }}>{c.footer.ownerCopy ? "(Customers see: Unsubscribe · Delete my data)" : "Unsubscribe · Delete my data"}</div>
            )}
          </div>
        </div>
      </div>
    ),
    { width: WIDTH, height: estimateHeight(c), emoji: "twemoji", headers: { "Cache-Control": "private, max-age=300" } },
  );
}
