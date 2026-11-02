import "server-only";
import { Document, Link, Page, Rect, renderToBuffer, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { changeLine, gbp, labourLine, MONTHLY_FOOTNOTE, ordinal, type MonthlyReportData } from "./monthly-rules";
import { clean } from "./pdf";
import { whatsappLink } from "./types";

// The monthly report as an A4 PDF in the restaurant's colours: the file the owner
// gets on WhatsApp and by email each month. Same content as the web page.

const INK = "#1c1917";
const SOFT = "#57534e";
const FAINT = "#78716c";
const LINE = "#e7e5e4";
const GOOD = "#047857";
const BAD = "#b91c1c";
const MUTED = "#d6d3d1";

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 40, fontFamily: "Helvetica", fontSize: 10, color: INK, backgroundColor: "#ffffff" },
  header: { marginTop: -32, paddingHorizontal: 40, paddingTop: 32, paddingBottom: 24, color: "#ffffff" },
  accent: { width: 28, height: 3, borderRadius: 2, marginBottom: 10 },
  small: { fontSize: 9, color: "#d6d3d1" },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4 },
  body: { paddingHorizontal: 40, paddingTop: 20 },
  section: { marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: LINE },
  h2: { fontSize: 9, fontFamily: "Helvetica-Bold", color: FAINT, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" },
  sentence: { fontSize: 14, fontFamily: "Helvetica-Bold", lineHeight: 1.35, marginBottom: 6 },
  row: { flexDirection: "row", gap: 14 },
  stat: { flex: 1 },
  value: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  label: { fontSize: 9, color: SOFT, marginTop: 1 },
  h3: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  item: { fontSize: 9.5, color: SOFT, marginBottom: 3, lineHeight: 1.35 },
  action: { flexDirection: "row", gap: 10, marginBottom: 10 },
  num: { width: 18, height: 18, borderRadius: 9, color: "#ffffff", fontSize: 9, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 4 },
  link: { fontSize: 9, marginTop: 3, textDecoration: "none" },
  footnote: { fontSize: 8, color: FAINT, lineHeight: 1.35 },
  footer: { position: "absolute", bottom: 18, left: 40, right: 40, fontSize: 8, color: FAINT, flexDirection: "row", justifyContent: "space-between" },
});

const W = 515; // A4 width less the margins

// One bar per day of the month (grey where there were no sales).
function DailyBars({ daily, brand }: { daily: { day: string; net: number | null }[]; brand: string }) {
  const h = 70;
  const max = Math.max(1, ...daily.map((d) => d.net ?? 0));
  const step = W / daily.length;
  return (
    <Svg width={W} height={h + 2}>
      {daily.map((d, i) => {
        const v = d.net ?? 0;
        const bh = v > 0 ? Math.max(2, (v / max) * h) : 2;
        return <Rect key={d.day} x={i * step + 1} y={h - bh} width={Math.max(2, step - 2)} height={bh} fill={v > 0 ? brand : MUTED} />;
      })}
    </Svg>
  );
}

function HBars({ rows, brand, format = gbp }: { rows: { label: string; value: number }[]; brand: string; format?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
          <Text style={{ width: 120, fontSize: 9, color: SOFT }}>{clean(r.label)}</Text>
          <View style={{ flex: 1, height: 8, backgroundColor: "#f5f5f4" }}>
            <View style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, height: 8, backgroundColor: brand }} />
          </View>
          <Text style={{ width: 60, fontSize: 9, textAlign: "right" }}>{format(r.value)}</Text>
        </View>
      ))}
    </View>
  );
}

function MonthlyPdf({ data }: { data: MonthlyReportData }) {
  const f = data.figures;
  const brand = data.restaurant.brandColor;
  const lfl = f.vsLastMonth?.likeForLike;
  return (
    <Document title={`${data.restaurant.name} ${f.label} report`} author={data.restaurant.name}>
      <Page size="A4" style={s.page}>
        <View style={[s.header, { backgroundColor: data.restaurant.brandDark }]}>
          <View style={[s.accent, { backgroundColor: brand }]} />
          <Text style={s.small}>Monthly report · {clean(f.label)}</Text>
          <Text style={s.title}>{clean(data.restaurant.name)}</Text>
          {data.simulated ? <Text style={[s.small, { marginTop: 6, color: "#fcd34d" }]}>{clean(data.simulated)}</Text> : null}
        </View>
        <View style={s.body}>
          <View style={s.section} wrap={false}>
            <Text style={s.sentence}>{clean(data.words.headline)}</Text>
            {data.words.summary !== data.words.headline ? <Text style={s.item}>{clean(data.words.summary)}</Text> : null}
            <View style={[s.row, { marginTop: 8 }]}>
              <View style={s.stat}>
                <Text style={s.value}>{gbp(f.net)}</Text>
                <Text style={s.label}>net takings, {f.traded} trading days</Text>
              </View>
              {f.orders ? (
                <View style={s.stat}>
                  <Text style={s.value}>{f.orders.toLocaleString("en-GB")}</Text>
                  <Text style={s.label}>orders, {gbp(f.avgOrder ?? 0)} average</Text>
                </View>
              ) : null}
              {lfl != null ? (
                <View style={s.stat}>
                  <Text style={[s.value, { color: lfl >= 0 ? GOOD : BAD }]}>{`${lfl >= 0 ? "+" : "-"}${Math.abs(lfl)}%`}</Text>
                  <Text style={s.label}>vs {clean(f.vsLastMonth!.label)}, like for like</Text>
                </View>
              ) : null}
            </View>
            {f.vsLastMonth ? <Text style={[s.item, { marginTop: 8 }]}>{clean(changeLine(f.vsLastMonth))}.</Text> : null}
            {f.vsLastYear ? <Text style={s.item}>{clean(changeLine(f.vsLastYear))}.</Text> : null}
          </View>

          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Day by day</Text>
            <DailyBars daily={f.daily} brand={brand} />
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 2 }}>
              <Text style={s.footnote}>1st</Text>
              <Text style={s.footnote}>{ordinal(f.days)}</Text>
            </View>
          </View>

          {f.movers.length || f.closures.length ? (
            <View style={s.section} wrap={false}>
              <Text style={s.h2}>What moved the month</Text>
              {f.movers.map((m) => (
                <Text key={m.day} style={s.item}>
                  {clean(`${m.label}: ${gbp(m.net)}, ${m.diff >= 0 ? "+" : "-"}${gbp(Math.abs(m.diff))} on a usual ${m.label.split(" ")[0]}. ${m.reason}.`)}
                </Text>
              ))}
              {f.closures.map((c) => (
                <Text key={c.day} style={s.item}>
                  {clean(`${c.label}: no sales (closed?). A usual day like it takes ${gbp(c.usual)}.`)}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Your week</Text>
            <HBars rows={f.weekdays.filter((w) => w.avg !== null).map((w) => ({ label: `${w.weekday} (average)`, value: w.avg! }))} brand={brand} />
            {f.hours ? <Text style={[s.item, { marginTop: 6 }]}>{clean(`Busiest hour: ${f.hours.busiest}. Quietest: ${f.hours.quietest}.`)}</Text> : null}
          </View>

          {f.dishes ? (
            <View style={s.section} wrap={false}>
              <Text style={s.h2}>Your dishes</Text>
              <HBars rows={f.dishes.top.map((d) => ({ label: d.item, value: d.amount }))} brand={brand} />
              <Text style={[s.item, { marginTop: 6 }]}>{clean(`Your top 3 dishes are ${f.dishes.topShare}% of dish sales.`)}</Text>
              {f.dishes.rising.length ? <Text style={s.item}>{clean(`Rising: ${f.dishes.rising.map((d) => `${d.item} +${d.change}%`).join(", ")}.`)}</Text> : null}
              {f.dishes.falling.length ? <Text style={s.item}>{clean(`Falling: ${f.dishes.falling.map((d) => `${d.item} ${d.change}%`).join(", ")}.`)}</Text> : null}
              {f.dishes.slow.length ? <Text style={s.item}>{clean(`Selling under 5 a week: ${f.dishes.slow.map((d) => d.item).join(", ")}.`)}</Text> : null}
            </View>
          ) : null}

          {f.labour || f.reviews ? (
            <View style={s.section} wrap={false}>
              <Text style={s.h2}>Staff and reviews</Text>
              <View style={s.row}>
                {f.labour ? (
                  <View style={s.stat}>
                    <Text style={[s.value, f.labour.target ? { color: f.labour.pct <= f.labour.target ? GOOD : BAD } : {}]}>{f.labour.pct}%</Text>
                    <Text style={s.label}>{clean(labourLine(f.labour, f.traded))}</Text>
                  </View>
                ) : null}
                {f.reviews ? (
                  <View style={s.stat}>
                    <Text style={s.value}>{f.reviews.count}</Text>
                    <Text style={s.label}>{`new Google reviews${f.reviews.average ? `, ${f.reviews.average} stars average` : ""}`}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          <View style={s.section} wrap={false}>
            <Text style={s.h2}>Three things for next month</Text>
            {data.words.actions.map((a, i) => {
              const link = whatsappLink(data.whatsappNumber, a.message);
              return (
                <View key={a.title} style={s.action}>
                  <Text style={[s.num, { backgroundColor: brand }]}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.h3}>{clean(a.title)}</Text>
                    {a.why ? <Text style={s.item}>{clean(a.why)}</Text> : null}
                    {link ? (
                      <Link src={link} style={[s.link, { color: INK }]}>
                        Start in WhatsApp
                      </Link>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          {f.missing.length ? (
            <View style={[s.section, { borderBottomWidth: 0 }]} wrap={false}>
              <Text style={s.h2}>More next month</Text>
              {f.missing.map((m) => (
                <Text key={m} style={s.item}>
                  {clean(m)}
                </Text>
              ))}
            </View>
          ) : null}
          <Text style={s.footnote}>{MONTHLY_FOOTNOTE}</Text>
        </View>
        <View style={s.footer} fixed>
          <Text>{clean(data.restaurant.name)} · {clean(f.label)}</Text>
          <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export function renderMonthlyPdf(data: MonthlyReportData) {
  return renderToBuffer(<MonthlyPdf data={data} />);
}
