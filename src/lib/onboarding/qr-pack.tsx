import "server-only";
import { Document, Image, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { Restaurant } from "@/lib/supabase";

// The printable QR pack: page 1 is four table cards (cut along the dashed
// lines), page 2 a counter sign. In the restaurant's colours; every code leads
// to its sign-up page. The built-in PDF font has no emoji, so text is cleaned.

const MM = 72 / 25.4;

function clean(text: string) {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^ -~ -ÿ–—…€£\n]/g, "")
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
