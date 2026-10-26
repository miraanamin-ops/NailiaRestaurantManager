import "server-only";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";
import { noEmDash } from "@/lib/text";
import type { RotaView } from "./view";

// The published rota as an A4 landscape PDF to print or forward: one row per
// person, one column per day, then each day's shifts with open ones marked.
// The built-in PDF font (Helvetica) has no emoji, so text is cleaned first.

const INK = "#1c1917";
const SOFT = "#57534e";
const LINE = "#e7e5e4";

const s = StyleSheet.create({
  page: { padding: 28, fontFamily: "Helvetica", fontSize: 9, color: INK },
  head: { marginBottom: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  title: { fontSize: 16, fontFamily: "Helvetica-Bold" },
  sub: { fontSize: 10, color: SOFT, marginTop: 2 },
  accent: { width: 28, height: 3, borderRadius: 2, marginBottom: 6 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, minHeight: 20, alignItems: "center" },
  headRow: { flexDirection: "row", borderBottomWidth: 1.5, borderBottomColor: INK, minHeight: 18, alignItems: "center" },
  name: { width: 120, paddingRight: 4, fontFamily: "Helvetica-Bold" },
  cell: { flex: 1, paddingHorizontal: 3 },
  hours: { width: 40, textAlign: "right" },
  bold: { fontFamily: "Helvetica-Bold" },
  days: { flexDirection: "row", flexWrap: "wrap", marginTop: 16, gap: 8 },
  day: { width: "24%", borderWidth: 1, borderColor: LINE, borderRadius: 4, padding: 6 },
  dayTitle: { fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: SOFT, fontSize: 8, marginBottom: 3 },
  open: { color: "#b45309" },
  foot: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 7, color: SOFT },
});

const clean = (t: string) => noEmDash(t).replace(/[^\x20-\x7E£–\n]/g, "").trim();

function RotaPdf({ view, brand }: { view: RotaView; brand: string }) {
  return (
    <Document title={clean(`${view.title} rota ${view.week}`)}>
      <Page size="A4" orientation="landscape" style={s.page}>
        <View style={s.head}>
          <View>
            <View style={[s.accent, { backgroundColor: brand }]} />
            <Text style={s.title}>{clean(view.title)}</Text>
            <Text style={s.sub}>Rota · {clean(view.week)}</Text>
          </View>
          {view.openShifts ? <Text style={s.open}>{view.openShifts} open shift{view.openShifts === 1 ? "" : "s"} still to fill</Text> : null}
        </View>
        <View style={s.headRow}>
          <Text style={[s.name]}>Name</Text>
          {view.dayHeads.map((d) => (
            <Text key={d} style={[s.cell, s.bold]}>
              {d}
            </Text>
          ))}
          <Text style={[s.hours, s.bold]}>Hours</Text>
        </View>
        {view.people.map((p) => (
          <View key={p.name} style={s.row} wrap={false}>
            <Text style={s.name}>{clean(p.name)}</Text>
            {p.cells.map((c, i) => (
              <Text key={i} style={s.cell}>
                {c || "-"}
              </Text>
            ))}
            <Text style={s.hours}>{p.hours}</Text>
          </View>
        ))}
        <View style={s.days}>
          {view.days.map((d) => (
            <View key={d.date} style={s.day} wrap={false}>
              <Text style={s.dayTitle}>{d.label}</Text>
              <Text style={s.muted}>{d.open === "Closed" ? "Closed" : `Open ${d.open}`}</Text>
              {d.shifts.map((x, i) => (
                <Text key={i} style={x.name.startsWith("Open shift") ? s.open : undefined}>
                  {x.time} {clean(x.name)} ({x.role})
                </Text>
              ))}
            </View>
          ))}
        </View>
        <Text style={s.foot} fixed>
          Made with DinerAI. Ask your manager about any changes.
        </Text>
      </Page>
    </Document>
  );
}

export function renderRotaPdf(view: RotaView, brand: string) {
  return renderToBuffer(<RotaPdf view={view} brand={brand} />);
}
