import "server-only";
import { Document, Link, Page, Rect, renderToBuffer, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { gbp, highlightsOf, labourLine, MONTHLY_FOOTNOTE, notIncluded, ordinal, type MonthlyReportData } from "./monthly-rules";
import { clean } from "./pdf";
import { whatsappLink } from "./types";

// The monthly report as an A4 PDF in the restaurant's colours: the file the owner
// gets on WhatsApp and by email each month. Numbers and charts first, then the AI's
// 3 or 4 key messages about them, then three actions. Same content as the web page.

const INK = "#1c1917";
const SOFT = "#57534e";
const FAINT = "#78716c";
const LINE = "#e7e5e4";
const TILE = "#f5f5f4";
const GOOD = "#047857";
const BAD = "#b91c1c";
const MUTED = "#d6d3d1";

const s = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 40, fontFamily: "Helvetica", fontSize: 10, color: INK, backgroundColor: "#ffffff" },
  header: { marginTop: -32, paddingHorizontal: 40, paddingTop: 30, paddingBottom: 22, color: "#ffffff" },
  accent: { width: 28, height: 3, borderRadius: 2, marginBottom: 10 },
  small: { fontSize: 9, color: "#d6d3d1" },
  title: { fontSize: 22, fontFamily: "Helvetica-Bold", marginTop: 4 },
  body: { paddingHorizontal: 40, paddingTop: 18 },
  block: { marginBottom: 16 },
  h2: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: FAINT, letterSpacing: 1, marginBottom: 8, textTransform: "uppercase" },
  tiles: { flexDirection: "row", gap: 10, marginBottom: 16 },
  tile: { flex: 1, backgroundColor: TILE, borderRadius: 6, padding: 10 },
  value: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  label: { fontSize: 8.5, color: SOFT, marginTop: 2 },
  highlights: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 2, marginBottom: 18 },
  hlItem: { marginBottom: 7 },
  hlTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", lineHeight: 1.3 },
  hlDetail: { fontSize: 9.5, color: SOFT, lineHeight: 1.35, marginTop: 1 },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, fontSize: 7.5, color: FAINT },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 3 },
  barLabel: { width: 110, fontSize: 8.5, color: SOFT },
  barTrack: { flex: 1, height: 7, backgroundColor: TILE },
  barValue: { width: 52, fontSize: 8.5, textAlign: "right" },
  note: { fontSize: 8.5, color: SOFT, marginTop: 5 },
  action: { flexDirection: "row", gap: 10, marginBottom: 8 },
  num: { width: 16, height: 16, borderRadius: 8, color: "#ffffff", fontSize: 8.5, fontFamily: "Helvetica-Bold", textAlign: "center", paddingTop: 3.5 },
  aTitle: { fontSize: 10, fontFamily: "Helvetica-Bold" },
  aWhy: { fontSize: 9, color: SOFT, lineHeight: 1.35, marginTop: 1 },
  link: { fontSize: 8.5, marginTop: 2, color: INK },
  footnote: { fontSize: 7.5, color: FAINT, lineHeight: 1.35, marginTop: 4, paddingTop: 8, borderTopWidth: 1, borderTopColor: LINE },
  footer: { position: "absolute", bottom: 18, left: 40, right: 40, fontSize: 8, color: FAINT, flexDirection: "row", justifyContent: "space-between" },
});

const W = 515; // A4 width less the margins

// One bar per day of the month (grey where there were no sales).
function DailyBars({ daily, brand }: { daily: { day: string; net: number | null }[]; brand: string }) {
  const h = 60;
  const max = Math.max(1, ...daily.map((d) => d.net ?? 0));
  const step = W / daily.length;
  return (
    <Svg width={W} height={h}>
      {daily.map((d, i) => {
        const v = d.net ?? 0;
        const bh = v > 0 ? Math.max(2, (v / max) * h) : 2;
        return <Rect key={d.day} x={i * step + 1} y={h - bh} width={Math.max(2, step - 2)} height={bh} fill={v > 0 ? brand : MUTED} />;
      })}
    </Svg>
  );
}

function HBars({ rows, brand }: { rows: { label: string; value: number }[]; brand: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View>
      {rows.map((r) => (
        <View key={r.label} style={s.barRow}>
          <Text style={s.barLabel}>{clean(r.label)}</Text>
          <View style={s.barTrack}>
            <View style={{ width: `${Math.max(1, (r.value / max) * 100)}%`, height: 7, backgroundColor: brand }} />
          </View>
          <Text style={s.barValue}>{gbp(r.value)}</Text>
        </View>
      ))}
    </View>
  );
}

function Tile({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={s.tile}>
      <Text style={[s.value, color ? { color } : {}]}>{clean(value)}</Text>
      <Text style={s.label}>{clean(label)}</Text>
    </View>
  );
}

function MonthlyPdf({ data }: { data: MonthlyReportData }) {
  const f = data.figures;
  const brand = data.restaurant.brandColor;
  const lfl = f.vsLastMonth?.likeForLike;
  const yoy = f.vsLastYear?.likeForLike;
  const left = notIncluded(f);
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
          <View style={s.tiles}>
            <Tile value={gbp(f.net)} label={`net takings, ${f.traded} trading days`} />
            {f.orders ? <Tile value={f.orders.toLocaleString("en-GB")} label={`orders, ${gbp(f.avgOrder ?? 0)} average`} /> : null}
            {lfl != null ? <Tile value={`${lfl >= 0 ? "+" : "-"}${Math.abs(lfl)}%`} label={`vs ${f.vsLastMonth!.label.split(" ")[0]}, like for like`} color={lfl >= 0 ? GOOD : BAD} /> : null}
            {yoy != null ? <Tile value={`${yoy >= 0 ? "+" : "-"}${Math.abs(yoy)}%`} label={`vs ${f.vsLastYear!.label}`} color={yoy >= 0 ? GOOD : BAD} /> : null}
          </View>

          <View style={[s.highlights, { borderLeftColor: brand }]}>
            <Text style={s.h2}>What stood out</Text>
            {highlightsOf(data).map((h) => (
              <View key={h.title} style={s.hlItem}>
                <Text style={s.hlTitle}>{clean(h.title)}</Text>
                {h.detail ? <Text style={s.hlDetail}>{clean(h.detail)}</Text> : null}
              </View>
            ))}
          </View>

          <View style={s.block} wrap={false}>
            <Text style={s.h2}>Takings day by day</Text>
            <DailyBars daily={f.daily} brand={brand} />
            <View style={s.axis}>
              <Text>1st</Text>
              <Text>{ordinal(f.days)}</Text>
            </View>
          </View>

          <View style={s.block} wrap={false}>
            <Text style={s.h2}>Average by weekday</Text>
            <HBars rows={f.weekdays.filter((w) => w.avg !== null).map((w) => ({ label: w.weekday, value: w.avg! }))} brand={brand} />
            {f.hours ? <Text style={s.note}>{clean(`Busiest hour: ${f.hours.busiest}. Quietest: ${f.hours.quietest}.`)}</Text> : null}
          </View>

          {f.dishes ? (
            <View style={s.block} wrap={false}>
              <Text style={s.h2}>Top dishes</Text>
              <HBars rows={f.dishes.top.map((d) => ({ label: d.item, value: d.amount }))} brand={brand} />
            </View>
          ) : null}

          {f.labour || f.reviews ? (
            <View style={s.tiles} wrap={false}>
              {f.labour ? (
                <Tile value={`${f.labour.pct}%`} label={labourLine(f.labour, f.traded)} color={f.labour.target ? (f.labour.pct <= f.labour.target ? GOOD : BAD) : undefined} />
              ) : null}
              {f.reviews ? <Tile value={String(f.reviews.count)} label={`new Google reviews${f.reviews.average ? `, ${f.reviews.average} stars average` : ""}`} /> : null}
            </View>
          ) : null}

          <View style={s.block} wrap={false}>
            <Text style={s.h2}>Three things for next month</Text>
            {data.words.actions.map((a, i) => {
              const link = whatsappLink(data.whatsappNumber, a.message);
              return (
                <View key={a.title} style={s.action}>
                  <Text style={[s.num, { backgroundColor: brand }]}>{i + 1}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.aTitle}>{clean(a.title)}</Text>
                    {a.why ? <Text style={s.aWhy}>{clean(a.why)}</Text> : null}
                    {link ? (
                      <Link src={link} style={s.link}>
                        Start in WhatsApp
                      </Link>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>

          <Text style={s.footnote}>{clean([left, MONTHLY_FOOTNOTE].filter(Boolean).join(" "))}</Text>
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
