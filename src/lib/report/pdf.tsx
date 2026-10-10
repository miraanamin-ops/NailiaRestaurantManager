import "server-only";
import { Document, Link, Page, Rect, renderToBuffer, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { shorten } from "@/lib/text";
import { bars, CHART, MUTED_BAR, weekTotals } from "./chart";
import {
  changeText,
  direction,
  formatValue,
  SECTION_TITLES,
  whatsappLink,
  type ActionsSection,
  type Compare,
  type CustomersSection,
  type Daily,
  type GoogleSection,
  type HeadlineSection,
  type ReportData,
  type ReportSection,
  type ReputationSection,
  type SalesSection,
  type ValueFormat,
  SALES_FOOTNOTE,
} from "./types";

// The same report as the web page, as a clean A4 PDF in the restaurant's colours.
// The built-in PDF font (Helvetica) has no emoji or arrows, so text is cleaned first.

const INK = "#1c1917";
const SOFT = "#57534e";
const FAINT = "#78716c";
const LINE = "#e7e5e4";
const GOOD = "#047857";
const BAD = "#b91c1c";

// Keeps only characters Helvetica can draw (Latin-1 plus common punctuation).
function clean(text: string) {
  return text
    .replace(/[−]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^ -~ -ÿ–—…€\n]/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const s = StyleSheet.create({
  // Top padding gives every page a margin; the header cancels it on page 1 so it runs to the edge.
  page: { paddingTop: 32, paddingBottom: 40, fontFamily: "Helvetica", fontSize: 10, color: INK, backgroundColor: "#ffffff" },
  header: { marginTop: -32, paddingHorizontal: 40, paddingTop: 32, paddingBottom: 24, color: "#ffffff" },
  accent: { width: 28, height: 3, borderRadius: 2, marginBottom: 10 },
  small: { fontSize: 9, color: "#d6d3d1" },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4 },
  body: { paddingHorizontal: 40, paddingTop: 20 },
  section: { marginBottom: 18, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: LINE },
  h2: { fontSize: 9, fontFamily: "Helvetica-Bold", color: FAINT, letterSpacing: 1, marginBottom: 10, textTransform: "uppercase" },
  sentence: { fontSize: 14, fontFamily: "Helvetica-Bold", lineHeight: 1.35, marginBottom: 12 },
  row: { flexDirection: "row", gap: 14 },
  stat: { flex: 1 },
  value: { fontSize: 20, fontFamily: "Helvetica-Bold" },
  bigValue: { fontSize: 26, fontFamily: "Helvetica-Bold" },
  label: { fontSize: 9, color: SOFT, marginTop: 1 },
  change: { fontSize: 8, marginTop: 2 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  item: { fontSize: 9.5, color: SOFT, marginBottom: 3, lineHeight: 1.35 },
  legend: { flexDirection: "row", gap: 12, marginTop: 4 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4, fontSize: 8, color: SOFT },
  swatch: { width: 7, height: 7, borderRadius: 1 },
  action: { flexDirection: "row", gap: 10, marginBottom: 10 },
  num: { width: 18, height: 18, borderRadius: 9, color: "#ffffff", fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 4 },
  link: { fontSize: 9, marginTop: 3, textDecoration: "none" },
  footer: { position: "absolute", bottom: 18, left: 40, right: 40, fontSize: 8, color: FAINT, flexDirection: "row", justifyContent: "space-between" },
});

function ChangeText({ value, format = "count" }: { value: Compare; format?: ValueFormat }) {
  const d = direction(value, format);
  return <Text style={[s.change, { color: d === "same" ? FAINT : d === "up" ? GOOD : BAD }]}>{clean(changeText(value, format))}</Text>;
}

function Stat({ label, value, format = "count", big = false }: { label: string; value: Compare; format?: ValueFormat; big?: boolean }) {
  return (
    <View style={s.stat}>
      <Text style={big ? s.bigValue : s.value}>{formatValue(value.now, format)}</Text>
      <Text style={s.label}>{label}</Text>
      <ChangeText value={value} format={format} />
    </View>
  );
}

function Chart({ daily, brand, what, format = String }: { daily: Daily; brand: string; what: string; format?: (n: number) => string }) {
  const totals = weekTotals(daily);
  const w = 515; // A4 width minus margins, in points
  const scale = w / CHART.width;
  const plotH = CHART.height - CHART.labelSpace;
  return (
    <View style={{ marginTop: 10 }}>
      <Svg width={w} height={plotH * scale * 0.6} viewBox={`0 0 ${CHART.width} ${plotH}`} preserveAspectRatio="none">
        {bars(daily).map((b, i) => (
          <Rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.lastWeek ? brand : MUTED_BAR} />
        ))}
      </Svg>
      <View style={s.legend}>
        <View style={s.legendItem}>
          <View style={[s.swatch, { backgroundColor: MUTED_BAR }]} />
          <Text>Week before: {clean(format(totals.before))}</Text>
        </View>
        <View style={s.legendItem}>
          <View style={[s.swatch, { backgroundColor: brand }]} />
          <Text>Last week: {clean(format(totals.now))}</Text>
        </View>
        <Text style={{ fontSize: 8, color: FAINT }}>
          {what} per day, {clean(daily.days[0])} to {clean(daily.days[13])}
        </Text>
      </View>
    </View>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={s.h3}>{title}</Text>
      {items.map((t) => (
        <Text key={t} style={s.item}>
          - {clean(t)}
        </Text>
      ))}
    </View>
  );
}

function Headline({ x, data }: { x: HeadlineSection; data: ReportData }) {
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.sentence}>{clean(x.sentence)}</Text>
      <View style={s.row}>
        {x.stats.map((st) => (
          <View key={st.label} style={s.stat}>
            <Text style={[s.bigValue, { color: data.restaurant.brandDark }]}>{formatValue(st.value.now, st.format)}</Text>
            <Text style={s.label}>{clean(st.label)}</Text>
            <ChangeText value={st.value} format={st.format} />
          </View>
        ))}
      </View>
    </View>
  );
}

const money = (n: number) => formatValue(n, "money");

function Sales({ x, brand }: { x: SalesSection; brand: string }) {
  const notes = [
    x.daysWithData.now < 7 ? `Figures for ${x.daysWithData.now} of last week's 7 days.` : null,
    x.topItems.length ? "Item totals include VAT." : null,
    x.netEstimated ? "Some days come from till exports that only give totals with VAT, so their net is worked out at 20% VAT." : null,
    x.dummy ? "Includes dummy sales data for testing." : null,
    SALES_FOOTNOTE,
  ].filter((n): n is string => Boolean(n));
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.h2}>{SECTION_TITLES.sales}</Text>
      <View style={s.row}>
        <Stat label="Net sales (excluding VAT)" value={x.net} format="money" big />
        {x.avgSpend && <Stat label="Average spend per sale" value={x.avgSpend} format="money" />}
        {x.transactions && <Stat label="Number of sales" value={x.transactions} />}
      </View>
      {x.lastMonth !== null && (
        <Text style={[s.change, { color: SOFT }]}>{clean(changeText({ now: x.net.now, before: x.lastMonth }, "money", "the same week last month"))}</Text>
      )}
      <Chart daily={x.daily} brand={brand} what="Net sales" format={money} />
      {x.best && x.worst && (
        <Text style={[s.item, { marginTop: 8 }]}>
          Best day: {clean(x.best.day)} ({clean(money(x.best.amount))}). Quietest: {clean(x.worst.day)} ({clean(money(x.worst.amount))}).
        </Text>
      )}
      {x.topItems.length > 0 && (
        <View style={{ marginTop: 8 }}>
          <Text style={s.h3}>Top {x.topItems.length} items last week</Text>
          {x.topItems.map((t, i) => (
            <Text key={t.name} style={s.item}>
              {i + 1}. {clean(t.name)}: {t.quantity} sold, {clean(money(t.amount))}
            </Text>
          ))}
        </View>
      )}
      {notes.map((n) => (
        <Text key={n} style={[s.item, { fontSize: 8, color: FAINT, marginBottom: 1 }]}>
          {clean(n)}
        </Text>
      ))}
    </View>
  );
}

function Reputation({ x, brand }: { x: ReputationSection; brand: string }) {
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.h2}>{SECTION_TITLES.reputation}</Text>
      <View style={s.row}>
        <Stat label={`Google rating (out of 5) · ${x.totalReviews} reviews`} value={x.rating} format="rating" big />
        <Stat label="New reviews" value={x.newReviews} />
        <Stat label="Reviews answered" value={x.answered} />
      </View>
      <Chart daily={x.daily} brand={brand} what="New reviews" />
      {(x.praise.length > 0 || x.complaints.length > 0) && (
        <View style={[s.row, { marginTop: 10 }]}>
          {x.praise.length > 0 && <List title="What customers love" items={x.praise} />}
          {x.complaints.length > 0 && <List title="What to fix" items={x.complaints} />}
        </View>
      )}
    </View>
  );
}

function Customers({ x, brand }: { x: CustomersSection; brand: string }) {
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.h2}>{SECTION_TITLES.customers}</Text>
      <View style={s.row}>
        <Stat label="New sign-ups" value={x.signups} big />
        <Stat label="Redeemed (offers + rewards)" value={x.redemptions} big />
        <Stat label="Welcome rewards used" value={x.rewardRedemptions} />
      </View>
      <View style={[s.row, { marginTop: 10 }]}>
        <Stat label="Emails sent" value={x.emailsSent} />
        <Stat label="Opened" value={x.opens} />
        <Stat label="Clicked" value={x.clicks} />
      </View>
      <Chart daily={x.daily} brand={brand} what="Sign-ups" />
      {x.campaigns.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Text style={s.h3}>Campaigns last week</Text>
          {x.campaigns.map((c) => (
            <Text key={c.name} style={s.item}>
              - {clean(c.name)}: {c.sent} sent, {c.opened} opened, {c.redeemed} redeemed
            </Text>
          ))}
        </View>
      )}
      {x.simulated > 0 && (
        <Text style={[s.item, { fontSize: 8, color: FAINT, marginTop: 4 }]}>
          Test mode: {x.simulated} of last week&apos;s emails were simulated (only your copy is really sent).
        </Text>
      )}
    </View>
  );
}

function GoogleVisibility({ x }: { x: GoogleSection }) {
  return (
    <View style={s.section} wrap={false}>
      <Text style={s.h2}>{SECTION_TITLES.google}</Text>
      <View style={s.row}>
        <Stat label="Posts published" value={x.posts} big />
        {x.insights && <Stat label="Listing views" value={x.insights.views} />}
        {x.insights && <Stat label="Calls" value={x.insights.calls} />}
        {x.insights && <Stat label="Directions" value={x.insights.directions} />}
      </View>
      {x.recentPosts.map((p) => (
        <Text key={p.publishedAt} style={[s.item, { marginTop: 6 }]}>
          - {shorten(clean(p.text), 220)}
        </Text>
      ))}
    </View>
  );
}

function Actions({ x, data, brand }: { x: ActionsSection; data: ReportData; brand: string }) {
  return (
    <View style={[s.section, { borderBottomWidth: 0 }]} wrap={false}>
      <Text style={s.h2}>{SECTION_TITLES.actions}</Text>
      {x.actions.map((a, i) => {
        const link = whatsappLink(data.whatsappNumber, a.message);
        return (
          <View key={a.title} style={s.action}>
            <Text style={[s.num, { backgroundColor: brand }]}>{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.h3}>{clean(a.title)}</Text>
              <Text style={s.item}>{clean(a.why)}</Text>
              {link && (
                <Link src={link} style={[s.link, { color: brand }]}>
                  Start in WhatsApp
                </Link>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function PdfSection({ section, data }: { section: ReportSection; data: ReportData }) {
  const brand = data.restaurant.brandColor;
  switch (section.id) {
    case "headline":
      return <Headline x={section} data={data} />;
    case "sales":
      return <Sales x={section} brand={brand} />;
    case "reputation":
      return <Reputation x={section} brand={brand} />;
    case "customers":
      return <Customers x={section} brand={brand} />;
    case "google":
      return <GoogleVisibility x={section} />;
    case "actions":
      return <Actions x={section} data={data} brand={brand} />;
    default:
      return null;
  }
}

function ReportPdf({ data }: { data: ReportData }) {
  return (
    <Document title={`${data.restaurant.name} weekly report ${data.period.label}`} author={data.restaurant.name}>
      <Page size="A4" style={s.page}>
        <View style={[s.header, { backgroundColor: data.restaurant.brandDark }]}>
          <View style={[s.accent, { backgroundColor: data.restaurant.brandColor }]} />
          <Text style={s.small}>Weekly report · {clean(data.period.label)}</Text>
          <Text style={s.title}>{clean(data.restaurant.name)}</Text>
          <Text style={[s.small, { marginTop: 4, color: "#a8a29e" }]}>Compared with the week before ({clean(data.period.prevLabel)})</Text>
        </View>
        <View style={s.body}>
          {data.sections.map((section) => (
            <PdfSection key={section.id} section={section} data={data} />
          ))}
        </View>
        <View style={s.footer} fixed>
          <Text>{clean(data.restaurant.name)} · weekly report</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderReportPdf(data: ReportData) {
  return renderToBuffer(<ReportPdf data={data} />);
}
