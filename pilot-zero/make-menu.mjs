// Makes pilot-zero/dummy-menu.pdf: a made-up menu for the Pilot Zero food hall,
// several counters under one roof, with the dishes and prices the test sales use
// (make-files.mjs). For Dina's menu step.
//   node pilot-zero/make-menu.mjs
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { Document, Page, renderToBuffer, StyleSheet, Text, View } from "@react-pdf/renderer";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "dummy-menu.pdf");
const h = React.createElement;

const COUNTERS = [
  {
    name: "Shawarma Corner",
    items: [
      ["Lamb Shawarma Wrap", "8.50", "Slow-roasted lamb, garlic sauce, pickles, fries inside"],
      ["Chicken Shawarma Wrap", "7.50", "Marinated chicken, garlic toum, pickled turnip"],
      ["Falafel Wrap", "7.50", "Crispy falafel, hummus, salad, tahini (vegan)"],
      ["Shawarma Plate", "12.00", "Lamb or chicken, rice, salad, hummus, pitta"],
    ],
  },
  {
    name: "Charcoal Grill",
    items: [
      ["Mixed Grill Platter", "16.50", "Lamb chops, chicken tikka, seekh kebab, rice, naan"],
      ["Lamb Chops (4)", "13.00", "Marinated overnight, grilled over charcoal"],
      ["Peri Peri Half Chicken", "10.50", "Mild, hot or extra hot, with one side"],
      ["Chicken Tikka Box", "9.50", "Tikka, rice, salad, mint sauce"],
    ],
  },
  {
    name: "Biryani House",
    items: [
      ["Lamb Biryani", "11.00", "Basmati, slow-cooked lamb, raita"],
      ["Chicken Biryani", "10.00", "Basmati, spiced chicken, raita"],
      ["Vegetable Biryani", "8.50", "Seasonal vegetables, fried onions, raita"],
    ],
  },
  {
    name: "Smash Burgers",
    items: [
      ["Smash Burger", "9.00", "Double beef patty, cheese, house sauce, brioche bun"],
      ["Chicken Burger", "8.50", "Crispy fillet, slaw, chilli mayo"],
      ["Masala Chips", "4.00", "Fries tossed in masala sauce"],
      ["Loaded Fries", "5.50", "Cheese sauce, jalapenos, crispy onions"],
    ],
  },
  {
    name: "Sweets & Drinks",
    items: [
      ["Kunafa", "6.00", "Warm, with cheese and syrup"],
      ["Mango Lassi", "3.50", "Yoghurt, mango, cardamom"],
      ["Karak Chai", "2.50", "Strong spiced tea with evaporated milk"],
      ["Soft Drinks", "1.80", "Can"],
    ],
  },
];

const s = StyleSheet.create({
  page: { padding: 36, fontFamily: "Helvetica", fontSize: 10, color: "#1d2420" },
  title: { fontSize: 24, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  sub: { fontSize: 10, color: "#5b655f", marginBottom: 16 },
  counter: { marginBottom: 12 },
  counterName: { fontSize: 13, fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: "#cfd5cc", paddingBottom: 3, marginBottom: 5 },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  name: { fontFamily: "Helvetica-Bold" },
  desc: { color: "#5b655f", fontSize: 9 },
  price: { fontFamily: "Helvetica-Bold", width: 50, textAlign: "right" },
  foot: { marginTop: 10, fontSize: 9, color: "#5b655f" },
});

const doc = h(
  Document,
  { title: "Pilot Zero Food Hall menu" },
  h(
    Page,
    { size: "A4", style: s.page },
    h(Text, { style: s.title }, "Pilot Zero Food Hall"),
    h(Text, { style: s.sub }, "Five counters, one roof. Ilford. Open every day 12pm to 11pm. All our meat is halal."),
    ...COUNTERS.map((c) =>
      h(
        View,
        { style: s.counter, key: c.name, wrap: false },
        h(Text, { style: s.counterName }, c.name),
        ...c.items.map(([n, p, d]) => h(View, { style: s.row, key: n }, h(View, { style: { flex: 1, paddingRight: 8 } }, h(Text, { style: s.name }, n), h(Text, { style: s.desc }, d)), h(Text, { style: s.price }, `£${p}`))),
      ),
    ),
    h(Text, { style: s.foot }, "Please tell us about any allergies before you order. Made-up menu for testing DinerAI."),
  ),
);

writeFileSync(OUT, await renderToBuffer(doc));
console.log(`Wrote ${OUT}`);
