import { Body, Button, Column, Container, Head, Heading, Html, Img, Link, Preview, Row, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";
import { plainText, type EmailContent } from "./content";

// One mobile-first layout for every customer email, in the restaurant's colours:
// header band with logo and name, heading, words, an offer box, big buttons,
// sign-off, and a footer with unsubscribe and delete-my-data links.
// Built from tables with inline styles (React Email), which Gmail, Apple Mail
// and Outlook all display the same way. Single column, max 560px wide, 16px text.

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MUTED = "#78716c";

export function EmailLayout({ c }: { c: EmailContent }) {
  const b = c.brand;
  return (
    <Html lang="en">
      <Head>
        <meta name="color-scheme" content="light only" />
        <meta name="supported-color-schemes" content="light only" />
      </Head>
      <Preview>{c.preheader}</Preview>
      <Body style={{ margin: 0, padding: 0, backgroundColor: "#f5f5f4", fontFamily: FONT, color: "#1c1917" }}>
        <Container style={{ maxWidth: 560, width: "100%", margin: "0 auto", padding: "16px 8px" }}>
          <Section style={{ backgroundColor: "#ffffff", borderRadius: 16, overflow: "hidden" }}>
            {/* Header */}
            <Section style={{ backgroundColor: b.dark, padding: "24px 20px", textAlign: "center" }}>
              {b.logoUrl && (
                <Img src={b.logoUrl} alt={b.name} height={56} style={{ margin: "0 auto 10px", maxHeight: 56, width: "auto", borderRadius: 8 }} />
              )}
              <Text style={{ margin: 0, color: b.onDark, fontSize: 22, lineHeight: "28px", fontWeight: 700 }}>{b.name}</Text>
              {b.tagline && <Text style={{ margin: "4px 0 0", color: b.onDark, opacity: 0.75, fontSize: 13, lineHeight: "18px" }}>{b.tagline}</Text>}
            </Section>

            {/* Body */}
            <Section style={{ padding: "28px 24px 8px" }}>
              {c.banner && (
                <Text style={{ margin: "0 0 8px", color: b.color, fontSize: 14, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>{c.banner}</Text>
              )}
              <Heading as="h1" style={{ margin: "0 0 14px", fontSize: 24, lineHeight: "30px", fontWeight: 700 }}>
                {c.heading}
              </Heading>
              {c.paragraphs.map((p, i) => (
                <Text key={i} style={{ margin: "0 0 14px", fontSize: 16, lineHeight: "24px" }}>
                  {p.split("\n").map((line, j) => (
                    <span key={j}>
                      {j > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </Text>
              ))}

              {c.offer && (
                <Section style={{ margin: "8px 0 20px", border: `2px dashed ${b.color}`, borderRadius: 12, padding: "18px 12px", textAlign: "center" }}>
                  <Text style={{ margin: 0, fontSize: 20, lineHeight: "26px", fontWeight: 700, color: b.color }}>{c.offer.title}</Text>
                  <Text style={{ margin: "6px 0 0", fontSize: 13, lineHeight: "18px", color: MUTED }}>{c.offer.detail}</Text>
                </Section>
              )}

              {c.stars && (
                <Section style={{ margin: "4px 0 18px", textAlign: "center" }}>
                  <Text style={{ margin: "0 0 6px", fontSize: 14, color: MUTED }}>Tap to rate your visit (private, to the owner):</Text>
                  <Row style={{ width: 260, margin: "0 auto" }}>
                    {c.stars.map((url, i) => (
                      <Column key={url} align="center" style={{ width: 52 }}>
                        <Link href={url} style={{ fontSize: 34, lineHeight: "40px", color: "#f59e0b", textDecoration: "none" }} aria-label={`${i + 1} star${i ? "s" : ""}`}>
                          ★
                        </Link>
                      </Column>
                    ))}
                  </Row>
                </Section>
              )}

              {c.buttons.map((btn) => (
                <Section key={btn.url} style={{ textAlign: "center", margin: "0 0 12px" }}>
                  <Button
                    href={btn.url}
                    style={
                      btn.style === "primary"
                        ? { backgroundColor: b.color, color: b.onColor, borderRadius: 999, padding: "14px 28px", fontSize: 16, fontWeight: 700, textDecoration: "none", display: "inline-block" }
                        : { backgroundColor: "#ffffff", color: b.dark, border: `2px solid ${b.dark}`, borderRadius: 999, padding: "12px 26px", fontSize: 16, fontWeight: 700, textDecoration: "none", display: "inline-block" }
                    }
                  >
                    {btn.label}
                  </Button>
                </Section>
              ))}

              {c.note && <Text style={{ margin: "8px 0 16px", fontSize: 13, lineHeight: "19px", color: MUTED }}>{c.note}</Text>}
              {c.signOff && (
                <Text style={{ margin: "8px 0 20px", fontSize: 16, lineHeight: "24px" }}>
                  {c.signOff.split("\n").map((line, j) => (
                    <span key={j}>
                      {j > 0 && <br />}
                      {line}
                    </span>
                  ))}
                </Text>
              )}
            </Section>

            {/* Footer */}
            <Section style={{ padding: "16px 24px 24px", borderTop: "1px solid #e7e5e4" }}>
              <Text style={{ margin: 0, fontSize: 12, lineHeight: "18px", color: MUTED }}>
                {b.name}
                {b.address ? ` · ${b.address}` : ""}
                <br />
                {c.footer.reason}
                {(c.footer.unsubscribeUrl || c.footer.deleteUrl) && <br />}
                {c.footer.unsubscribeUrl && (
                  <Link href={c.footer.unsubscribeUrl} style={{ color: MUTED, textDecoration: "underline" }}>
                    Unsubscribe
                  </Link>
                )}
                {c.footer.unsubscribeUrl && c.footer.deleteUrl && " · "}
                {c.footer.deleteUrl && (
                  <Link href={c.footer.deleteUrl} style={{ color: MUTED, textDecoration: "underline" }}>
                    Delete my data
                  </Link>
                )}
              </Text>
            </Section>
          </Section>
        </Container>
        {c.trackingPixel && <Img src={c.trackingPixel} width={1} height={1} alt="" style={{ display: "block", border: 0 }} />}
      </Body>
    </Html>
  );
}

export async function renderEmail(c: EmailContent) {
  const html = await render(<EmailLayout c={c} />);
  return { html, text: plainText(c) };
}
