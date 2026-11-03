import "server-only";
import { noEmDash } from "@/lib/text";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { Restaurant } from "@/lib/supabase";

// The printable QR pack: page 1 is four table cards (cut along the dashed
// lines), page 2 a counter sign. In the restaurant's colours; every code leads
// to its sign-up page. The built-in PDF font has no emoji, so text is cleaned.

const MM = 72 / 25.4;

function clean(text: string) {
  return noEmDash(text)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^ -~ -ÿ–…€£\n]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", color: "#1c1917", backgroundColor: "#ffffff" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  // A6, a quarter of A4. Dashed edges are the cutting lines.
  card: {
    width: 105 * MM,
    height: 148.5 * MM,
    borderStyle: "dashed",
    borderColor: "#d6d3d1",
    borderWidth: 0.5,
    alignItems: "center",
    paddingBottom: 14,
  },
  band: { width: "100%", paddingVertical: 16, paddingHorizontal: 14, alignItems: "center", color: "#ffffff" },
  accent: { width: 26, height: 3, borderRadius: 2, marginTop: 6 },
  name: { fontSize: 17, fontFamily: "Helvetica-Bold", textAlign: "center" },
  scan: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 14 },
  reward: { fontSize: 15, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 3, paddingHorizontal: 14 },
  qrSmall: { width: 46 * MM, height: 46 * MM, marginTop: 10 },
  hint: { fontSize: 8, color: "#57534e", marginTop: 6 },
  url: { fontSize: 7, color: "#78716c", marginTop: 3 },
  // Counter sign.
  signBand: { paddingVertical: 40, paddingHorizontal: 48, alignItems: "center", color: "#ffffff" },
  signName: { fontSize: 34, fontFamily: "Helvetica-Bold", textAlign: "center" },
  signTagline: { fontSize: 13, color: "#e7e5e4", marginTop: 6, textAlign: "center" },
  signBody: { alignItems: "center", paddingHorizontal: 48, paddingTop: 30 },
  signJoin: { fontSize: 24, fontFamily: "Helvetica-Bold" },
  signReward: { fontSize: 30, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 6 },
  qrBig: { width: 95 * MM, height: 95 * MM, marginTop: 24 },
  steps: { flexDirection: "row", gap: 18, marginTop: 24 },
  step: { alignItems: "center", width: 140 },
  stepNo: { width: 26, height: 26, borderRadius: 13, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 13, textAlign: "center", paddingTop: 6 },
  stepText: { fontSize: 11, textAlign: "center", marginTop: 6 },
  signUrl: { fontSize: 10, color: "#78716c", marginTop: 22 },
});

type Brand = Pick<Restaurant, "name" | "tagline" | "brand_color" | "brand_dark" | "signup_reward">;

export async function renderQrPack(r: Brand, signupUrl: string) {
  const qr = await QRCode.toDataURL(signupUrl, { margin: 1, width: 900, errorCorrectionLevel: "M", color: { dark: r.brand_dark, light: "#ffffff" } });
  const reward = clean(r.signup_reward ?? "a welcome treat");
  const name = clean(r.name);
  const shortUrl = signupUrl.replace(/^https?:\/\//, "");

  const card = (i: number) => (
    <View key={i} style={s.card}>
      <View style={[s.band, { backgroundColor: r.brand_dark }]}>
        <Text style={s.name}>{name}</Text>
        <View style={[s.accent, { backgroundColor: r.brand_color }]} />
      </View>
      <Text style={s.scan}>Scan to join and get</Text>
      <Text style={[s.reward, { color: r.brand_color }]}>{reward}</Text>
      {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt text */}
      <Image src={qr} style={s.qrSmall} />
      <Text style={s.hint}>Point your phone camera at the code</Text>
      <Text style={s.url}>{shortUrl}</Text>
    </View>
  );

  const doc = (
    <Document title={`${name}: QR codes`} author="Naila">
      <Page size="A4" style={s.page}>
        <View style={s.grid}>{[0, 1, 2, 3].map(card)}</View>
      </Page>
      <Page size="A4" style={s.page}>
        <View style={[s.signBand, { backgroundColor: r.brand_dark }]}>
          <Text style={s.signName}>{name}</Text>
          {r.tagline && <Text style={s.signTagline}>{clean(r.tagline)}</Text>}
          <View style={[s.accent, { backgroundColor: r.brand_color, width: 40, height: 4 }]} />
        </View>
        <View style={s.signBody}>
          <Text style={s.signJoin}>Join our list and get</Text>
          <Text style={[s.signReward, { color: r.brand_color }]}>{reward}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt text */}
          <Image src={qr} style={s.qrBig} />
          <View style={s.steps}>
            {["Scan the code with your phone camera", "Add your name and number (30 seconds)", `Show your phone to get ${reward}`].map((t, i) => (
              <View key={i} style={s.step}>
                <Text style={[s.stepNo, { backgroundColor: r.brand_color }]}>{i + 1}</Text>
                <Text style={s.stepText}>{t}</Text>
              </View>
            ))}
          </View>
          <Text style={s.signUrl}>{shortUrl}</Text>
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}

// ---------- The QR poster (the business review) ----------
// One page, A4 (the counter or the window) or A5 (the tables): the name, the
// sign-up reward, a big QR code to the sign-up page, "Scan to join and get ...".
// The restaurant's colours if it has them, otherwise a clean default.

export const POSTER_SIZES = ["A4", "A5"] as const;
export type PosterSize = (typeof POSTER_SIZES)[number];
const DEFAULT_DARK = "#1c1917";
const DEFAULT_ACCENT = "#c2410c";

export async function renderPoster(r: Partial<Brand> & Pick<Brand, "name">, signupUrl: string, size: PosterSize) {
  const dark = r.brand_dark || DEFAULT_DARK;
  const accent = r.brand_color || DEFAULT_ACCENT;
  const k = size === "A4" ? 1 : 0.7; // A5 is 70% of A4 on each side
  const qr = await QRCode.toDataURL(signupUrl, { margin: 1, width: 1000, errorCorrectionLevel: "M", color: { dark, light: "#ffffff" } });
  const reward = clean(r.signup_reward || "a welcome treat");
  const name = clean(r.name);
  const doc = (
    <Document title={`${name}: QR poster (${size})`} author="DinerAI">
      <Page size={size} style={s.page}>
        <View style={{ backgroundColor: dark, paddingVertical: 44 * k, paddingHorizontal: 40 * k, alignItems: "center", color: "#ffffff" }}>
          <Text style={{ fontSize: 36 * k, fontFamily: "Helvetica-Bold", textAlign: "center" }}>{name}</Text>
          {r.tagline ? <Text style={{ fontSize: 14 * k, color: "#e7e5e4", marginTop: 8 * k, textAlign: "center" }}>{clean(r.tagline)}</Text> : null}
          <View style={{ width: 44 * k, height: 4 * k, borderRadius: 2, marginTop: 10 * k, backgroundColor: accent }} />
        </View>
        <View style={{ alignItems: "center", paddingHorizontal: 40 * k, paddingTop: 34 * k }}>
          <Text style={{ fontSize: 26 * k, fontFamily: "Helvetica-Bold", textAlign: "center" }}>Scan to join and get</Text>
          <Text style={{ fontSize: 32 * k, fontFamily: "Helvetica-Bold", textAlign: "center", marginTop: 6 * k, color: accent }}>{reward}</Text>
          {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt text */}
          <Image src={qr} style={{ width: 110 * MM * k, height: 110 * MM * k, marginTop: 26 * k }} />
          <Text style={{ fontSize: 12 * k, color: "#57534e", marginTop: 16 * k }}>Point your phone camera at the code</Text>
          <Text style={{ fontSize: 10 * k, color: "#78716c", marginTop: 6 * k }}>{signupUrl.replace(/^https?:\/\//, "")}</Text>
        </View>
      </Page>
    </Document>
  );
  return renderToBuffer(doc);
}
