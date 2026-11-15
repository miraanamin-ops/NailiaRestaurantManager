import { Body, Column, Container, Head, Html, Img, Link, Preview, Row, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import type { ReactNode } from "react";
import { contrast, type Brand } from "./brand";
import { plainText, type DesignFacts, type EmailContent } from "./content";

// Every customer email, drawn from the owner's Stitch mock-ups (15 Nov 2026): a warm
// page, the restaurant's logo and name at the top, one look per campaign family (three
// looks each for discounts, occasions, quiet nights and new dishes, taking turns;
// lib/email/designs.ts), and a dark footer with Unsubscribe and Delete my data. Each
// restaurant's own logo, colours and sign-off; with no photo, each look has its own
// no-photo version. Tables and inline styles (React Email) so Gmail, Apple Mail and
// Outlook show them the same; single column, 600px wide, kept well under Gmail's
// 102 KB clipping size.

const HEAD = "'Epilogue', 'Arial Black', Arial, Helvetica, sans-serif";
const BODY = "'Work Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'Courier New', Courier, monospace";
const PAGE = "#f6f2ec";
const CARD = "#ffffff";
const INK = "#1b1a17";
const MUTED = "#6b6560";
const LINE = "#e9e3dc";
const PANEL = "#f4efe9";
const STAR = "#f59e0b";
const FONTS = "https://fonts.googleapis.com/css2?family=Epilogue:wght@700;800&family=Work+Sans:wght@400;600&display=swap";

const lines = (text: string) =>
  text.split("\n").map((line, j) => (
    <span key={j}>
      {j > 0 && <br />}
      {line}
    </span>
  ));

// The brand colour as text on a light background: itself when it reads (3:1, the big-type
// rule), else the darker brand colour (a pale yellow or orange brand colour is unreadable on white).
const ink = (b: Brand) => (contrast(b.color, "#ffffff") >= 3 ? b.color : contrast(b.dark, "#ffffff") >= 3 ? b.dark : INK);

const money = (n: number) => (Number.isInteger(n) ? `£${n}` : `£${n.toFixed(2)}`);

// ---------- Shared pieces ----------

function Shell({ c, children }: { c: EmailContent; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
        <link href={FONTS} rel="stylesheet" />
      </Head>
      <Preview>{c.preheader}</Preview>
      {/* The gutter is the body's padding: padding on the 100%-wide container table would make it wider than a phone. */}
      <Body style={{ margin: 0, padding: "16px 10px", backgroundColor: PAGE, fontFamily: BODY, color: INK }}>
        <Container style={{ maxWidth: 600, width: "100%", margin: "0 auto" }}>
          {children}
          <Footer c={c} />
        </Container>
        {c.trackingPixel && <Img src={c.trackingPixel} width={1} height={1} alt="" style={{ display: "block", border: 0 }} />}
      </Body>
    </Html>
  );
}

// The logo (or the name's first letter in the brand colour), the name, the tagline.
function Masthead({ b, on = INK, sub = MUTED }: { b: Brand; on?: string; sub?: string }) {
  return (
    <Section style={{ textAlign: "center", padding: "22px 16px 14px" }}>
      {b.logoUrl ? (
        <Img src={b.logoUrl} alt={b.name} height={56} style={{ margin: "0 auto 10px", maxHeight: 56, width: "auto", borderRadius: 12 }} />
      ) : (
        <table role="presentation" align="center" cellPadding={0} cellSpacing={0} style={{ margin: "0 auto 10px" }}>
          <tbody>
            <tr>
              <td style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: b.color, color: b.onColor, fontFamily: HEAD, fontSize: 26, fontWeight: 800, textAlign: "center" }}>
                {b.name.trim()[0]?.toUpperCase() ?? "•"}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <Text style={{ margin: 0, fontFamily: HEAD, fontSize: 18, lineHeight: "24px", fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: on }}>{b.name}</Text>
      {b.tagline && <Text style={{ margin: "4px 0 0", fontSize: 11, lineHeight: "16px", letterSpacing: "0.16em", textTransform: "uppercase", color: sub }}>{b.tagline}</Text>}
    </Section>
  );
}

function Footer({ c }: { c: EmailContent }) {
  const b = c.brand;
  const soft = b.onDark === "#ffffff" ? "rgba(255,255,255,0.72)" : "rgba(28,25,23,0.72)";
  return (
    <Section style={{ backgroundColor: b.dark, borderRadius: 16, padding: "22px 20px", marginTop: 14, textAlign: "center" }}>
      <Text style={{ margin: 0, fontFamily: HEAD, fontSize: 15, fontWeight: 700, color: b.onDark }}>{b.name}</Text>
      {b.address && <Text style={{ margin: "4px 0 0", fontSize: 13, lineHeight: "19px", color: soft }}>{b.address}</Text>}
      <Text style={{ margin: "12px 0 0", fontSize: 12, lineHeight: "18px", color: soft }}>{c.footer.reason}</Text>
      {(c.footer.unsubscribeUrl || c.footer.deleteUrl) && (
        <Text style={{ margin: "10px 0 0", fontSize: 12, lineHeight: "18px", color: soft }}>
          {c.footer.unsubscribeUrl && (
            <Link href={c.footer.unsubscribeUrl} style={{ color: b.onDark, textDecoration: "underline" }}>
              Unsubscribe
            </Link>
          )}
          {c.footer.unsubscribeUrl && c.footer.deleteUrl && <span style={{ color: soft }}>{"  •  "}</span>}
          {c.footer.deleteUrl && (
            <Link href={c.footer.deleteUrl} style={{ color: b.onDark, textDecoration: "underline" }}>
              Delete my data
            </Link>
          )}
        </Text>
      )}
    </Section>
  );
}

// The main button, full width. invert: white with brand text (on a brand-coloured card).
function MainButton({ c, invert = false }: { c: EmailContent; invert?: boolean }) {
  const btn = c.buttons.find((x) => x.style === "primary") ?? c.buttons[0];
  if (!btn) return null;
  const b = c.brand;
  return (
    <Section style={{ margin: "18px 0 6px" }}>
      <Link
        href={btn.url}
        style={{
          display: "block",
          backgroundColor: invert ? "#ffffff" : b.color,
          color: invert ? ink(b) : b.onColor,
          borderRadius: 10,
          padding: "16px 20px",
          fontFamily: HEAD,
          fontSize: 17,
          fontWeight: 800,
          textAlign: "center",
          textDecoration: "none",
        }}
      >
        {btn.label}
      </Link>
    </Section>
  );
}

function SecondaryButtons({ c }: { c: EmailContent }) {
  const rest = c.buttons.filter((x) => x.style === "secondary");
  return (
    <>
      {rest.map((btn) => (
        <Section key={btn.url} style={{ margin: "10px 0 0" }}>
          <Link
            href={btn.url}
            style={{ display: "block", backgroundColor: PANEL, color: INK, border: `1px solid ${LINE}`, borderRadius: 10, padding: "14px 20px", fontSize: 15, fontWeight: 600, textAlign: "center", textDecoration: "none" }}
          >
            {btn.label}
          </Link>
        </Section>
      ))}
    </>
  );
}

function Note({ c, color = MUTED }: { c: EmailContent; color?: string }) {
  return c.note ? <Text style={{ margin: "8px 0 0", fontSize: 12, lineHeight: "18px", color, textAlign: "center" }}>{c.note}</Text> : null;
}

function Words({ c, color = INK, align = "left", size = 16 }: { c: EmailContent; color?: string; align?: "left" | "center"; size?: number }) {
  return (
    <>
      {c.paragraphs.map((p, i) => (
        <Text key={i} style={{ margin: "0 0 12px", fontSize: size, lineHeight: `${Math.round(size * 1.5)}px`, color, textAlign: align }}>
          {lines(p)}
        </Text>
      ))}
    </>
  );
}

function SignOff({ c, color = INK, align = "left" }: { c: EmailContent; color?: string; align?: "left" | "center" }) {
  if (!c.signOff) return null;
  const [first, ...rest] = c.signOff.split("\n");
  return (
    <Text style={{ margin: "22px 0 4px", fontSize: 15, lineHeight: "22px", color, textAlign: align }}>
      <span style={{ fontStyle: "italic" }}>{first}</span>
      {rest.length > 0 && (
        <>
          <br />
          <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17 }}>{rest.join(" ")}</span>
        </>
      )}
    </Text>
  );
}

function Pill({ text, bg, color }: { text: string; bg: string; color: string }) {
  return (
    <span style={{ display: "inline-block", backgroundColor: bg, color, borderRadius: 999, padding: "4px 12px", fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>{text}</span>
  );
}

function Heading1({ text, color = INK, size = 32, align = "left" }: { text: string; color?: string; size?: number; align?: "left" | "center" }) {
  return (
    <Text style={{ margin: "10px 0 12px", fontFamily: HEAD, fontSize: size, lineHeight: `${Math.round(size * 1.12)}px`, fontWeight: 800, letterSpacing: "-0.02em", color, textAlign: align }}>{text}</Text>
  );
}

function Photo({ url, alt, radius = 0 }: { url: string; alt: string; radius?: number }) {
  return <Img src={url} alt={alt} width="100%" style={{ display: "block", width: "100%", height: "auto", borderRadius: radius }} />;
}

function Rule({ color = LINE, dashed = false }: { color?: string; dashed?: boolean }) {
  return <Text style={{ margin: "8px 0", borderTop: `${dashed ? 2 : 1}px ${dashed ? "dashed" : "solid"} ${color}`, fontSize: 1, lineHeight: "1px" }}>&nbsp;</Text>;
}

const validLine = (d: DesignFacts) => `Valid ${d.validity}${d.conditions ? `. ${d.conditions}` : ""}`;

// Valid dates and "show this email at the till", in a soft box.
function ValidBox({ d }: { d: DesignFacts }) {
  return (
    <Section style={{ backgroundColor: PANEL, borderRadius: 12, padding: "14px 16px", margin: "6px 0 4px" }}>
      <Text style={{ margin: 0, fontSize: 15, lineHeight: "22px", fontWeight: 600 }}>Valid {d.validity}</Text>
      {d.conditions && <Text style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "20px", color: MUTED }}>{d.conditions}</Text>}
      <Text style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "20px", color: MUTED }}>Show this email at the till</Text>
    </Section>
  );
}

const card = (bg = CARD) => ({ backgroundColor: bg, borderRadius: 16, overflow: "hidden" as const });
const pad = { padding: "8px 22px 24px" };

// A block in the brand colour standing in for a photo: the name in big type over fine stripes.
function NoPhotoBlock({ b, text, tall = false }: { b: Brand; text: string; tall?: boolean }) {
  return (
    <Section
      style={{
        backgroundColor: b.color,
        backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.08) 0 2px, transparent 2px 14px)",
        padding: tall ? "70px 24px" : "48px 24px",
        textAlign: "center",
      }}
    >
      <Text style={{ margin: 0, fontFamily: HEAD, fontSize: 34, lineHeight: "38px", fontWeight: 800, color: b.onColor, letterSpacing: "-0.01em" }}>{text}</Text>
    </Section>
  );
}

// A small square: the photo, or the big number (or a star) on the brand colour.
function Thumb({ b, d, alt, size = 92 }: { b: Brand; d: DesignFacts; alt: string; size?: number }) {
  if (d.photoUrl) return <Img src={d.photoUrl} alt={alt} width={size} height={size} style={{ borderRadius: 10, objectFit: "cover" }} />;
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0}>
      <tbody>
        <tr>
          <td style={{ width: size, height: size, borderRadius: 10, backgroundColor: b.color, color: b.onColor, fontFamily: HEAD, fontSize: 28, fontWeight: 800, textAlign: "center" }}>{d.big?.big ?? "★"}</td>
        </tr>
      </tbody>
    </table>
  );
}

// ---------- Discount ----------

function PhotoHero({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const dish = d.dish?.name ?? null;
  return (
    <Section style={card()}>
      <Masthead b={b} />
      {d.photoUrl ? <Photo url={d.photoUrl} alt={dish ?? c.heading} /> : <NoPhotoBlock b={b} text={dish ?? c.offer?.title ?? c.heading} />}
      <Section style={pad}>
        <Text style={{ margin: "18px 0 0" }}>
          <Pill text={d.validity.endsWith("only") ? "One day only" : "This week"} bg={PANEL} color={ink(b)} />
        </Text>
        <Heading1 text={c.heading} />
        <Words c={c} color={MUTED} />
        <ValidBox d={d} />
        <MainButton c={c} />
        <Note c={c} />
        <SignOff c={c} />
      </Section>
    </Section>
  );
}

function BigNumber({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const on = b.onDark;
  const soft = on === "#ffffff" ? "rgba(255,255,255,0.75)" : MUTED;
  const accent = readableOn(b.color, b.dark) ? b.color : on;
  const big = d.big ?? { big: c.offer?.title ?? "", rest: "" };
  const small = big.big.length > 4;
  return (
    <Section style={card(b.dark)}>
      <Masthead b={b} on={on} sub={soft} />
      <Section style={{ padding: "0 22px 26px", textAlign: "center" }}>
        <Text style={{ margin: "4px 0 0", fontFamily: HEAD, fontSize: small ? 60 : 104, lineHeight: small ? "66px" : "104px", fontWeight: 800, letterSpacing: "-0.04em", color: accent }}>{big.big}</Text>
        <Text style={{ margin: "6px 0 18px", fontFamily: HEAD, fontSize: 24, lineHeight: "30px", fontWeight: 700, color: on }}>
          {[big.rest, d.dish ? `the ${d.dish.name.toLowerCase()}` : null].filter(Boolean).join(" ") || c.heading}
        </Text>
        {d.photoUrl && <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} radius={14} />}
        <Text style={{ margin: "18px 0 0", fontSize: 18, lineHeight: "26px", color: on }}>{d.validity}</Text>
        {d.conditions && <Text style={{ margin: "4px 0 10px", fontSize: 14, lineHeight: "20px", color: soft }}>{d.conditions}</Text>}
        <Words c={c} color={soft} align="center" size={15} />
        <MainButton c={c} />
        <Note c={c} color={soft} />
        <SignOff c={c} color={on} align="center" />
      </Section>
    </Section>
  );
}

function MenuCard({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const name = d.dish?.name ?? c.offer?.title ?? c.heading;
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 8px" }}>
        <Heading1 text={c.heading} align="center" size={28} />
        <Section style={{ backgroundColor: CARD, borderRadius: 14, border: `1px solid ${LINE}` }}>
          <Section style={{ padding: "18px 18px 14px" }}>
            <Row>
              <Column style={{ width: 106, verticalAlign: "top" }}>
                <Thumb b={b} d={d} alt={name} />
              </Column>
              <Column style={{ verticalAlign: "top" }}>
                <Text style={{ margin: 0, fontFamily: HEAD, fontSize: 21, lineHeight: "26px", fontWeight: 700 }}>{name}</Text>
                {d.dish?.description && <Text style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "20px", color: MUTED }}>{d.dish.description}</Text>}
                {d.prices ? (
                  <Text style={{ margin: "8px 0 0", fontSize: 15, color: MUTED }}>
                    <span style={{ textDecoration: "line-through" }}>{money(d.prices.was)}</span>{" "}
                    <span style={{ fontFamily: HEAD, fontSize: 24, fontWeight: 800, color: ink(b) }}>{money(d.prices.now)}</span>
                  </Text>
                ) : (
                  <Text style={{ margin: "8px 0 0", fontFamily: HEAD, fontSize: 20, fontWeight: 800, color: ink(b) }}>{c.offer?.title}</Text>
                )}
              </Column>
            </Row>
          </Section>
          <Section style={{ borderTop: `2px dashed ${LINE}`, backgroundColor: PANEL, padding: "12px 18px" }}>
            <Text style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>
              Valid {d.validity}
              {d.conditions ? `  •  ${d.conditions}` : ""}
            </Text>
          </Section>
        </Section>
        <Section style={{ padding: "14px 6px 0" }}>
          <Words c={c} color={MUTED} align="center" size={15} />
          <MainButton c={c} />
          <Note c={c} />
          <SignOff c={c} align="center" />
        </Section>
      </Section>
    </Section>
  );
}

// ---------- Occasion ----------

function OccasionBanner({ d, b, tall = false }: { d: DesignFacts; b: Brand; tall?: boolean }) {
  const o = d.occasion ?? { title: "A special day", icon: "✦", bg: b.dark, accent: b.color, on: b.onDark };
  return (
    <Section
      style={{
        backgroundColor: o.bg,
        backgroundImage: "repeating-linear-gradient(45deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 16px), repeating-linear-gradient(-45deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 16px)",
        borderRadius: 14,
        padding: tall ? "54px 20px" : "34px 20px",
        textAlign: "center",
      }}
    >
      <Text style={{ margin: 0, fontSize: 26, lineHeight: "30px", color: o.accent }}>{o.icon}</Text>
      <Text style={{ margin: "8px 0 0", fontFamily: HEAD, fontSize: 38, lineHeight: "44px", fontWeight: 800, color: o.on }}>{o.title}</Text>
      <Text style={{ margin: "12px auto 0", width: 120, borderTop: `2px solid ${o.accent}`, fontSize: 1, lineHeight: "1px" }}>&nbsp;</Text>
    </Section>
  );
}

function OfferCard({ c, d, label }: { c: EmailContent; d: DesignFacts; label: string }) {
  const b = c.brand;
  return (
    <Section style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, borderRadius: 14, padding: "16px 18px", margin: "14px 0 0" }}>
      <Text style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: ink(b) }}>{label}</Text>
      <Text style={{ margin: "4px 0 0", fontFamily: HEAD, fontSize: 21, lineHeight: "27px", fontWeight: 700 }}>{c.offer?.title}</Text>
      <Text style={{ margin: "4px 0 0", fontSize: 14, lineHeight: "20px", color: MUTED }}>{validLine(d)}</Text>
    </Section>
  );
}

function Banner({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <OccasionBanner d={d} b={b} tall={!d.photoUrl} />
        <Heading1 text={c.heading} align="center" size={26} />
        <Words c={c} color={MUTED} align="center" />
        <OfferCard c={c} d={d} label={`${d.occasion?.title ?? "Special"} offer`} />
        {d.photoUrl && (
          <Section style={{ marginTop: 14 }}>
            <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} radius={14} />
          </Section>
        )}
        <MainButton c={c} />
        <Note c={c} />
        <SignOff c={c} align="center" />
      </Section>
    </Section>
  );
}

function Invitation({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const o = d.occasion;
  const gold = o?.accent ?? b.color;
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <Section style={{ backgroundColor: "#fffdf8", border: `2px solid ${gold}`, borderRadius: 16, padding: "26px 20px", textAlign: "center" }}>
          <Text style={{ margin: 0, fontSize: 12, letterSpacing: "0.3em", textTransform: "uppercase", color: MUTED }}>You&apos;re invited</Text>
          {d.photoUrl && <Img src={d.photoUrl} alt={d.dish?.name ?? c.heading} width={120} height={120} style={{ margin: "16px auto 0", borderRadius: 60, objectFit: "cover" }} />}
          {o && <Text style={{ margin: "14px 0 0", fontSize: 22, color: gold }}>{o.icon}</Text>}
          <Heading1 text={c.heading} align="center" size={28} />
          <Text style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 600 }}>{d.validity}</Text>
          <Section style={{ backgroundColor: PANEL, borderRadius: 12, padding: "14px 16px" }}>
            <Text style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: gold }}>A gift for your table</Text>
            <Text style={{ margin: "4px 0 0", fontFamily: HEAD, fontSize: 19, lineHeight: "25px", fontWeight: 700 }}>{c.offer?.title}</Text>
            {d.conditions && <Text style={{ margin: "4px 0 0", fontSize: 13, lineHeight: "19px", color: MUTED }}>{d.conditions}</Text>}
          </Section>
          <Section style={{ marginTop: 14 }}>
            <Words c={c} color={MUTED} align="center" size={15} />
          </Section>
          <SignOff c={c} align="center" />
        </Section>
        <MainButton c={c} />
        <Note c={c} />
      </Section>
    </Section>
  );
}

function DateLed({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const o = d.occasion;
  const items = [c.offer?.title ?? null, `Valid ${d.validity}`, d.conditions].filter(Boolean) as string[];
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <Section style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, borderRadius: 14, overflow: "hidden" }}>
          <Section style={{ backgroundColor: o?.bg ?? b.dark, padding: "10px 18px" }}>
            <Text style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: o?.on ?? b.onDark }}>{o?.title ?? "Save the date"}</Text>
          </Section>
          {d.date && (
            <Section style={{ padding: "16px 18px 4px" }}>
              <Text style={{ margin: 0, fontSize: 13, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: MUTED }}>{d.date.weekday}</Text>
              <Text style={{ margin: 0, fontFamily: HEAD, fontSize: 52, lineHeight: "56px", fontWeight: 800, color: ink(b) }}>
                {d.date.day} {d.date.month.toUpperCase()}
              </Text>
            </Section>
          )}
          <Section style={{ padding: "4px 18px 18px" }}>
            <Heading1 text={c.heading} size={24} />
            {items.map((line) => (
              <Section key={line} style={{ backgroundColor: PANEL, borderRadius: 10, padding: "10px 14px", margin: "8px 0 0" }}>
                <Text style={{ margin: 0, fontSize: 15, lineHeight: "21px", fontWeight: 600 }}>{line}</Text>
              </Section>
            ))}
          </Section>
        </Section>
        {d.photoUrl && (
          <Section style={{ marginTop: 14 }}>
            <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} radius={14} />
          </Section>
        )}
        <Section style={{ marginTop: 14 }}>
          <Words c={c} color={MUTED} />
        </Section>
        <MainButton c={c} />
        <Note c={c} />
        <SignOff c={c} />
      </Section>
    </Section>
  );
}

// ---------- Quiet night ----------

function BigDay({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const on = b.onColor;
  const soft = on === "#ffffff" ? "rgba(255,255,255,0.85)" : "rgba(28,25,23,0.8)";
  const long = d.day.length > 7;
  return (
    <Section style={card(b.color)}>
      <Masthead b={b} on={on} sub={soft} />
      <Section style={{ padding: "0 22px 26px", textAlign: "center" }}>
        <Text style={{ margin: 0, fontFamily: HEAD, fontSize: long ? 54 : 70, lineHeight: long ? "60px" : "74px", fontWeight: 800, letterSpacing: "-0.03em", textTransform: "uppercase", color: on }}>{d.day}</Text>
        <Text style={{ margin: "12px 0 0" }}>
          <span style={{ display: "inline-block", backgroundColor: "#ffffff", color: ink(b), borderRadius: 8, padding: "8px 16px", fontFamily: HEAD, fontSize: 22, fontWeight: 800, textTransform: "uppercase" }}>{c.offer?.title}</span>
        </Text>
        <Text style={{ margin: "14px 0 0", fontSize: 16, lineHeight: "23px", color: on }}>{validLine(d)}</Text>
        {d.photoUrl && (
          <Section style={{ marginTop: 16, border: "6px solid #ffffff", borderRadius: 14 }}>
            <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} radius={8} />
          </Section>
        )}
        <Section style={{ marginTop: 14 }}>
          <Words c={c} color={soft} align="center" size={15} />
        </Section>
        <MainButton c={c} invert />
        <Note c={c} color={soft} />
        <SignOff c={c} color={on} align="center" />
      </Section>
    </Section>
  );
}

function TableForTwo({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const on = b.onDark;
  const soft = on === "#ffffff" ? "rgba(255,255,255,0.75)" : MUTED;
  const box = on === "#ffffff" ? "rgba(255,255,255,0.08)" : "rgba(28,25,23,0.06)";
  return (
    <Section style={card(b.dark)}>
      {d.photoUrl ? <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} /> : <Masthead b={b} on={on} sub={soft} />}
      <Section style={{ padding: "20px 22px 26px" }}>
        {d.photoUrl && <Text style={{ margin: 0, fontSize: 12, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: soft }}>{b.name}</Text>}
        <Heading1 text={c.heading} color={on} size={30} />
        <Words c={c} color={soft} />
        <Section style={{ backgroundColor: box, borderRadius: 14, padding: "18px 18px", marginTop: 6 }}>
          <Text style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: soft }}>{d.day}</Text>
          <Text style={{ margin: "4px 0 0", fontFamily: HEAD, fontSize: 30, lineHeight: "34px", fontWeight: 800, color: on }}>{c.offer?.title}</Text>
          <Text style={{ margin: "8px 0 0", fontSize: 14, lineHeight: "20px", color: soft }}>{validLine(d)}</Text>
        </Section>
        <MainButton c={c} />
        <Note c={c} color={soft} />
        <SignOff c={c} color={on} />
      </Section>
    </Section>
  );
}

function Receipt({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const mono = (bold = false) => ({ fontFamily: MONO, fontSize: 14, lineHeight: "22px", fontWeight: bold ? 700 : 400, color: INK });
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <Heading1 text={c.heading} align="center" size={28} />
        <Words c={c} color={MUTED} align="center" size={15} />
        {d.photoUrl && (
          <Section style={{ margin: "4px 0 14px" }}>
            <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} radius={14} />
          </Section>
        )}
        <Section style={{ backgroundColor: CARD, borderTop: `4px dotted ${LINE}`, borderBottom: `4px dotted ${LINE}`, padding: "18px 20px", margin: "0 10px" }}>
          <Text style={{ margin: 0, fontFamily: MONO, fontSize: 16, fontWeight: 700, textAlign: "center", textTransform: "uppercase" }}>{b.name}</Text>
          {b.address && <Text style={{ margin: "2px 0 0", fontFamily: MONO, fontSize: 12, color: MUTED, textAlign: "center" }}>{b.address}</Text>}
          <Rule color={MUTED} />
          <Text style={{ margin: 0, ...mono() }}>{`${d.day.toUpperCase()} SPECIAL`}</Text>
          <Row>
            <Column style={mono(true)}>{(c.offer?.title ?? "").toUpperCase()}</Column>
            <Column align="right" style={{ ...mono(true), whiteSpace: "nowrap" }}>
              {d.prices ? money(d.prices.now) : (d.big?.big ?? "")}
            </Column>
          </Row>
          <Rule color={MUTED} />
          <Text style={{ margin: 0, fontFamily: MONO, fontSize: 13, lineHeight: "20px", textAlign: "center", textTransform: "uppercase" }}>Valid {d.validity}</Text>
          {d.conditions && <Text style={{ margin: "2px 0 0", fontFamily: MONO, fontSize: 12, lineHeight: "18px", color: MUTED, textAlign: "center", textTransform: "uppercase" }}>{d.conditions}</Text>}
        </Section>
        <MainButton c={c} />
        <Note c={c} />
        <SignOff c={c} />
      </Section>
    </Section>
  );
}

// ---------- New dish ----------

function DishLine({ d, b }: { d: DesignFacts; b: Brand }) {
  if (!d.dish) return null;
  return (
    <>
      <Text style={{ margin: "14px 0 4px", fontFamily: HEAD, fontSize: 26, lineHeight: "31px", fontWeight: 800 }}>
        {d.dish.name}
        {d.dish.price ? <span style={{ color: ink(b), fontSize: 21 }}>{`  ${money(d.dish.price)}`}</span> : null}
      </Text>
      {d.dish.description && <Text style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: MUTED }}>{d.dish.description}</Text>}
    </>
  );
}

function Magazine({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  return (
    <Section style={card()}>
      <Masthead b={b} />
      <Text style={{ margin: "0 0 10px", textAlign: "center", fontSize: 12, fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: ink(b) }}>New on the menu</Text>
      {d.photoUrl ? <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} /> : <NoPhotoBlock b={b} text={d.dish?.name ?? c.heading} tall />}
      <Section style={pad}>
        <Text style={{ margin: "16px 0 0" }}>
          <Pill text="New" bg={b.color} color={b.onColor} />
        </Text>
        <Heading1 text={c.heading} size={28} />
        <DishLine d={d} b={b} />
        <Section style={{ marginTop: 12 }}>
          <Words c={c} color={MUTED} />
        </Section>
        {c.offer?.title && <OfferCard c={c} d={d} label="Your offer" />}
        <MainButton c={c} />
        <Note c={c} />
        <SignOff c={c} />
      </Section>
    </Section>
  );
}

function JustLanded({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const on = b.onDark;
  const soft = on === "#ffffff" ? "rgba(255,255,255,0.78)" : MUTED;
  const facts = [d.dish?.price ? { top: money(d.dish.price), sub: "Price" } : null, d.dish?.section ? { top: d.dish.section, sub: "On the menu" } : null, { top: "New", sub: "From today" }].filter(Boolean) as { top: string; sub: string }[];
  return (
    <Section style={card()}>
      <Section style={{ backgroundColor: b.dark, padding: "0 22px 26px", textAlign: "center" }}>
        <Masthead b={b} on={on} sub={soft} />
        <Pill text="Just landed" bg={b.color} color={b.onColor} />
        <Text style={{ margin: "12px 0 6px", fontFamily: HEAD, fontSize: 34, lineHeight: "38px", fontWeight: 800, color: on }}>{d.dish?.name ?? c.heading}</Text>
        {d.dish?.description && <Text style={{ margin: 0, fontSize: 15, lineHeight: "22px", color: soft }}>{d.dish.description}</Text>}
      </Section>
      {d.photoUrl && <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} />}
      <Section style={pad}>
        <Row style={{ marginTop: 16 }}>
          {facts.map((f) => (
            <Column key={f.sub} style={{ padding: "0 4px" }}>
              <Section style={{ backgroundColor: PANEL, borderRadius: 10, padding: d.photoUrl ? "10px 6px" : "18px 6px", textAlign: "center" }}>
                <Text style={{ margin: 0, fontFamily: HEAD, fontSize: d.photoUrl ? 17 : 20, lineHeight: "24px", fontWeight: 800, color: ink(b) }}>{f.top}</Text>
                <Text style={{ margin: "2px 0 0", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: MUTED }}>{f.sub}</Text>
              </Section>
            </Column>
          ))}
        </Row>
        <Heading1 text={c.heading} size={24} align="center" />
        <Words c={c} color={MUTED} align="center" />
        {c.offer?.title && <OfferCard c={c} d={d} label="Your offer" />}
        <MainButton c={c} />
        <Note c={c} />
        <SignOff c={c} align="center" />
      </Section>
    </Section>
  );
}

function ChefsNote({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const [first, ...rest] = c.paragraphs;
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <Section style={{ backgroundColor: "#fffdf8", border: `1px solid ${LINE}`, borderRadius: 16, padding: "22px 20px" }}>
          <Text style={{ margin: 0 }}>
            <Pill text={d.ownerFirst ? `A note from ${d.ownerFirst}` : "From the kitchen"} bg={PANEL} color={ink(b)} />
          </Text>
          <Text style={{ margin: "14px 0 10px", fontFamily: HEAD, fontSize: 26, lineHeight: "32px", fontWeight: 800, fontStyle: "italic" }}>“{c.heading}”</Text>
          {first && <Text style={{ margin: "0 0 12px", fontSize: 16, lineHeight: "25px" }}>{lines(first)}</Text>}
          {rest.map((p, i) => (
            <Text key={i} style={{ margin: "0 0 12px", fontSize: 15, lineHeight: "23px", color: MUTED }}>
              {lines(p)}
            </Text>
          ))}
          <SignOff c={c} />
        </Section>
        {(d.photoUrl || d.dish) && (
          <Section style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, borderRadius: 16, overflow: "hidden", marginTop: 14 }}>
            {d.photoUrl && <Photo url={d.photoUrl} alt={d.dish?.name ?? c.heading} />}
            <Section style={{ padding: "4px 20px 18px" }}>
              <DishLine d={d} b={b} />
            </Section>
          </Section>
        )}
        {c.offer?.title && <OfferCard c={c} d={d} label="Your offer" />}
        <MainButton c={c} />
        <Note c={c} />
      </Section>
    </Section>
  );
}

// ---------- Birthday ----------

function Birthday({ c, d }: { c: EmailContent; d: DesignFacts }) {
  const b = c.brand;
  const confetti = ["●", "▲", "✦", "~", "●", "✦", "▲", "~", "●"];
  const colours = [b.color, "#d4a531", b.dark, b.color, "#d4a531", b.color, b.dark, "#d4a531", b.color];
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <Section style={{ backgroundColor: CARD, borderRadius: 16, padding: "22px 20px", textAlign: "center" }}>
          <Text style={{ margin: 0, fontSize: 18, letterSpacing: "0.4em" }}>
            {confetti.map((ch, i) => (
              <span key={i} style={{ color: colours[i] }}>
                {ch}
              </span>
            ))}
          </Text>
          <Text style={{ margin: "14px 0 0" }}>
            <Pill text="A birthday treat for you" bg={PANEL} color={ink(b)} />
          </Text>
          <Heading1 text={c.heading} align="center" size={34} />
          <Words c={c} color={MUTED} align="center" />
        </Section>
        <Section style={{ backgroundColor: PANEL, borderRadius: 16, padding: "20px 20px", marginTop: 12, textAlign: "center" }}>
          <Text style={{ margin: 0, fontFamily: HEAD, fontSize: 24, lineHeight: "30px", fontWeight: 800 }}>{c.offer?.title}</Text>
          <Text style={{ margin: "6px 0 0", fontSize: 14, lineHeight: "20px", color: MUTED }}>{validLine(d)}</Text>
          <Rule dashed />
          <MainButton c={c} />
          <Note c={c} />
        </Section>
        <SignOff c={c} align="center" />
      </Section>
    </Section>
  );
}

// ---------- Confirm, welcome, feedback and the rest ----------

function Standard({ c }: { c: EmailContent }) {
  const b = c.brand;
  return (
    <Section style={card(PAGE)}>
      <Masthead b={b} />
      <Section style={{ padding: "0 8px 10px" }}>
        <Section style={{ backgroundColor: CARD, borderRadius: 16, padding: "24px 20px", textAlign: "center" }}>
          {c.banner && (
            <Text style={{ margin: "0 0 4px" }}>
              <Pill text={c.banner} bg={PANEL} color={ink(b)} />
            </Text>
          )}
          <Heading1 text={c.heading} align="center" size={30} />
          <Words c={c} color={MUTED} align="center" />
          {c.offer && (
            <Section style={{ backgroundColor: PANEL, borderRadius: 12, padding: "14px 16px", margin: "6px 0 4px", textAlign: "left" }}>
              <Text style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: ink(b) }}>{c.offer.detail}</Text>
              <Text style={{ margin: "4px 0 0", fontFamily: HEAD, fontSize: 20, lineHeight: "26px", fontWeight: 700 }}>{c.offer.title}</Text>
            </Section>
          )}
          {c.stars && (
            <Section style={{ backgroundColor: PANEL, borderRadius: 12, padding: "14px 10px", margin: "8px 0 4px" }}>
              <Text style={{ margin: "0 0 4px", fontSize: 14, color: MUTED }}>Tap a star to rate your visit (private, to the owner)</Text>
              <Row style={{ width: 280, margin: "0 auto" }}>
                {c.stars.map((url, i) => (
                  <Column key={url} align="center" style={{ width: 56 }}>
                    <Link href={url} style={{ fontSize: 40, lineHeight: "46px", color: STAR, textDecoration: "none" }} aria-label={`${i + 1} star${i ? "s" : ""}`}>
                      ★
                    </Link>
                  </Column>
                ))}
              </Row>
            </Section>
          )}
          <MainButton c={c} />
          <SecondaryButtons c={c} />
          <Note c={c} />
        </Section>
        <SignOff c={c} align="center" />
      </Section>
    </Section>
  );
}

// Is `fg` readable on `bg` (contrast 3:1, enough for big type)?
function readableOn(fg: string, bg: string) {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [x, y] = [lum(fg), lum(bg)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05) >= 3;
}

const LOOK_COMPONENTS = {
  photo_hero: PhotoHero,
  big_number: BigNumber,
  menu_card: MenuCard,
  banner: Banner,
  invitation: Invitation,
  date_led: DateLed,
  big_day: BigDay,
  table_for_two: TableForTwo,
  receipt: Receipt,
  magazine: Magazine,
  just_landed: JustLanded,
  chefs_note: ChefsNote,
  birthday: Birthday,
} as const;

export function EmailLayout({ c }: { c: EmailContent }) {
  const d = c.design;
  const Look = d ? LOOK_COMPONENTS[d.look] : null;
  return <Shell c={c}>{Look && d ? <Look c={c} d={d} /> : <Standard c={c} />}</Shell>;
}

export async function renderEmail(c: EmailContent) {
  const html = await render(<EmailLayout c={c} />);
  return { html, text: plainText(c) };
}
