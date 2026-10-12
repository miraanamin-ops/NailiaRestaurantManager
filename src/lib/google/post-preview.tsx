import { ImageResponse } from "next/og";

// A picture of a Google post as it shows on the listing, at phone width, for
// the checker's brand checks (B1 to B4: logo and colours, the photo, fit,
// nothing missing). A close drawing of Google's post card, not a screenshot.
// (The image library only understands a subset of CSS: every box with more
// than one child needs display: flex.)

const WIDTH = 420;

export type PostPreview = {
  name: string;
  logoUrl: string | null;
  brandColor: string;
  text: string;
  cta: string | null;
  // The photo's address, or a data: URL. Null: a post without a photo.
  photo: string | null;
};

function estimateHeight(p: PostPreview) {
  const lines = Math.max(1, Math.ceil((p.text.length * 15 * 0.55) / (WIDTH - 40)));
  return Math.min(1600, 90 + (p.photo ? 240 : 0) + lines * 22 + 40 + (p.cta ? 60 : 0) + 30);
}

export function postPreviewImage(p: PostPreview) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: "#f1f3f4", padding: 12 }}>
        <div style={{ display: "flex", flexDirection: "column", backgroundColor: "#ffffff", borderRadius: 12, overflow: "hidden", border: "1px solid #dadce0" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "12px 14px" }}>
            {p.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- drawn by the image library, not a page
              <img src={p.logoUrl} width={36} height={36} style={{ borderRadius: 18, objectFit: "cover" }} alt="" />
            ) : (
              <div style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: p.brandColor, color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                {p.name.slice(0, 1)}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", marginLeft: 10 }}>
              <div style={{ display: "flex", fontSize: 15, color: "#202124", fontWeight: 600 }}>{p.name}</div>
              <div style={{ display: "flex", fontSize: 12, color: "#5f6368" }}>Update · on Google</div>
            </div>
          </div>
          {p.photo && (
            // eslint-disable-next-line @next/next/no-img-element -- drawn by the image library, not a page
            <img src={p.photo} width={WIDTH - 26} height={240} style={{ objectFit: "cover" }} alt="" />
          )}
          <div style={{ display: "flex", padding: "12px 14px", fontSize: 15, lineHeight: 1.45, color: "#202124" }}>{p.text}</div>
          {p.cta && (
            <div style={{ display: "flex", padding: "0 14px 16px" }}>
              <div style={{ display: "flex", border: "1px solid #dadce0", borderRadius: 18, padding: "8px 16px", color: "#1a73e8", fontSize: 14, fontWeight: 600 }}>{p.cta}</div>
            </div>
          )}
        </div>
      </div>
    ),
    { width: WIDTH, height: estimateHeight(p), emoji: "twemoji" },
  );
}

export async function postPreviewPng(p: PostPreview): Promise<{ media_type: "image/png"; data: string }> {
  const png = await postPreviewImage(p).arrayBuffer();
  return { media_type: "image/png", data: Buffer.from(png).toString("base64") };
}
