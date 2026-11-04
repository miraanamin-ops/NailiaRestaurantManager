// The business review's fixture sites (all test sites, made-up businesses):
//   A  Saffron Coal Grill: Google connected (dummy), a profile with gaps, 60
//      reviews (1 to 5 stars, 22 with no reply), 5 rivals, nobody on the list
//   B  Mango Tree Cafe: Google not connected; public Places data only (3 rivals)
//   C  Little Lantern Bakery: 4 reviews, all answered; a complete profile; no rivals
// Reviews are built from hand-written sentences (no AI), the same every time.

export const SANDBOX = "whatsapp:+14155238886";

export const IDS = {
  A: "b0b0b0b0-0000-4000-8000-00000000000a",
  B: "b0b0b0b0-0000-4000-8000-00000000000b",
  C: "b0b0b0b0-0000-4000-8000-00000000000c",
} as const;

const week = (open: string, close: string) =>
  Object.fromEntries(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"].map((d) => [d, `${open} – ${close}`]));

const common = {
  is_test: true,
  is_demo: true,
  active: true,
  paused: false,
  send_window_start: "00:00:00",
  send_window_end: "23:59:00",
  discount_cap_percent: 20,
  agent_modes: null,
  fake_now: null,
  event_audiences: null,
  whatsapp_from: SANDBOX,
  owner_email: "owner@example.com",
  billing_exempt: true,
  brief_hour: 9,
};

const GRILL_MENU = [
  { category: "Grills", items: [{ name: "Lamb Chops (4 pcs)", price: 13.95 }, { name: "Mixed Grill Platter", price: 18.5 }, { name: "Chicken Tikka", price: 9.5 }] },
  { category: "Sides", items: [{ name: "Garlic Naan", price: 3 }, { name: "Masala Chips", price: 4 }] },
  { category: "Drinks", items: [{ name: "Mango Lassi", price: 3.5 }] },
];

export const restaurants = {
  A: {
    ...common,
    id: IDS.A,
    name: "Saffron Coal Grill",
    slug: "saffron-coal",
    owner_name: "Amira Khan",
    owner_whatsapp: "whatsapp:+447700900501",
    cuisine: "Grill",
    address: "12 Whitechapel Road, London E1 1EW",
    phone: "020 7946 0501",
    website: "https://saffroncoal.example",
    opening_hours: week("12:00", "23:00"),
    special_hours: null,
    halal_statement: "Yes, all our meat is HMC certified",
    faqs: { parking: "No, but there's pay and display on the next street", accessibility: "Yes, step-free entrance" },
    logo_url: null,
    tagline: "Charcoal grill, Whitechapel",
    brand_color: "#b45309",
    brand_dark: "#1c1917",
    signup_reward: "a free mango lassi",
    menu: GRILL_MENU,
    dummy_google_profile: {
      rating: 4.3,
      reviewCount: 60,
      description: "Charcoal grill in Whitechapel.",
      primaryCategory: "Halal restaurant",
      additionalCategories: [],
      regularHours: week("12:00", "23:00"),
      specialHours: {},
      phone: "020 7946 0501",
      website: null,
      menuLink: null,
      attributes: { halal: null, vegetarian: null, parking: null, wheelchair: true, outdoor_seating: false },
      photos: ["2026-02-01", "2026-02-01", "2026-03-10", "2026-03-10", "2026-04-02", "2026-04-02"].map((d) => ({ at: `${d}T12:00:00Z` })),
      logo: null,
      cover: null,
      places: {
        ours: { rating: 4.3, count: 60 },
        rivals: [
          { id: "fixture-a-1", name: "Charcoal House", rating: 4.5, count: 410 },
          { id: "fixture-a-2", name: "Whitechapel Kebabs", rating: 4.1, count: 220 },
          { id: "fixture-a-3", name: "Brick Lane Grill", rating: 4.3, count: 980 },
          { id: "fixture-a-4", name: "Lahori Nights", rating: 3.9, count: 156 },
          { id: "fixture-a-5", name: "Aldgate Shawarma", rating: 4.2, count: 75 },
        ],
      },
    },
  },
  B: {
    ...common,
    id: IDS.B,
    name: "Mango Tree Cafe",
    slug: "mango-tree",
    owner_name: "Dev Shah",
    owner_whatsapp: "whatsapp:+447700900502",
    cuisine: "Cafe",
    address: "4 High Road, Ilford IG1 1AA",
    phone: "020 7946 0502",
    website: null,
    opening_hours: week("08:00", "17:00"),
    special_hours: null,
    halal_statement: null,
    faqs: {},
    logo_url: null,
    tagline: null,
    brand_color: null,
    brand_dark: null,
    signup_reward: "10% off your next coffee",
    menu: [{ category: "Breakfast", items: [{ name: "Masala Omelette", price: 6.5 }, { name: "Chai Latte", price: 3.2 }] }],
    // Google not connected: only public Places data.
    dummy_google_profile: {
      connected: false,
      places: {
        ours: { rating: 4.1, count: 87 },
        rivals: [
          { id: "fixture-b-1", name: "Ilford Coffee Co", rating: 4.4, count: 120 },
          { id: "fixture-b-2", name: "High Road Kitchen", rating: 4.0, count: 64 },
          { id: "fixture-b-3", name: "Valentines Park Cafe", rating: 4.2, count: 301 },
        ],
      },
    },
  },
  C: {
    ...common,
    id: IDS.C,
    name: "Little Lantern Bakery",
    slug: "little-lantern",
    owner_name: "Jo Bell",
    owner_whatsapp: "whatsapp:+447700900503",
    cuisine: "Bakery",
    address: "2 Roman Road, London E3 5LU",
    phone: "020 7946 0503",
    website: "https://littlelantern.example",
    opening_hours: week("07:30", "16:00"),
    special_hours: { "2026-12-25": { hours: "Closed" }, "2026-12-26": { hours: "Closed" }, "2027-01-01": { hours: "Closed" } },
    halal_statement: null,
    faqs: {},
    logo_url: "https://littlelantern.example/logo.png",
    tagline: "Bread and pastries, baked daily",
    brand_color: "#0f766e",
    brand_dark: "#134e4a",
    signup_reward: "a free cinnamon bun",
    menu: [{ category: "Bakes", items: [{ name: "Cinnamon Bun", price: 3.2 }, { name: "Sourdough Loaf", price: 4.8 }] }],
    dummy_google_profile: {
      rating: 4.8,
      reviewCount: 4,
      description: "Little Lantern Bakery is a neighbourhood bakery on Roman Road in Bow, baking sourdough, cinnamon buns and seasonal pastries fresh every morning. Pop in for a coffee and something warm from the oven, or pick up a loaf on your way home. Everything is made on site by our small team, with flour from a British mill.",
      primaryCategory: "Bakery",
      additionalCategories: ["Coffee shop"],
      regularHours: week("07:30", "16:00"),
      specialHours: { "2026-12-25": { hours: "Closed" }, "2026-12-26": { hours: "Closed" }, "2027-01-01": { hours: "Closed" } },
      phone: "020 7946 0503",
      website: "https://littlelantern.example",
      menuLink: "https://littlelantern.example/menu",
      attributes: { halal: false, vegetarian: true, parking: false, wheelchair: true, outdoor_seating: true },
      photos: Array.from({ length: 12 }, (_, i) => ({ at: `2026-10-${String(10 + i).padStart(2, "0")}T09:00:00Z` })),
      logo: "https://littlelantern.example/logo.png",
      cover: "https://littlelantern.example/cover.jpg",
      places: { ours: { rating: 4.8, count: 4 }, rivals: [] },
    },
  },
};

// ---------- Site A's 60 reviews ----------

const AUTHORS = ["Priya S", "Tom H", "Fatima R", "James O", "Aisha M", "Dan W", "Nadia K", "Chris P", "Sofia L", "Imran A", "Grace T", "Omar B"];
const PRAISE = [
  "The lamb chops were perfect, smoky and tender.",
  "Lovely friendly staff, they made us feel welcome.",
  "Mixed grill platter was huge, great value for the price.",
  "Food came out quickly even on a busy Friday.",
  "Spotless inside and the atmosphere is really cosy.",
  "Best chicken tikka I've had in east London.",
  "Garlic naan was fresh and the mango lassi was lovely.",
  "Generous portions and the staff were attentive.",
];
const MIXED = ["Food was tasty but we waited a long time for our mains.", "Nice lamb chops but the music was far too loud."];
const COMPLAINTS = [
  "Waited over 45 minutes for our food. Far too slow.",
  "Service was slow and nobody checked on us.",
  "Chicken tikka was dry and the chips were cold.",
  "Very slow on a Saturday night, we nearly left.",
  "Prices have gone up a lot and the portions are smaller.",
  "Tables were sticky and the toilets weren't clean.",
];

export function siteAReviews() {
  // 30 five-star, 12 four-star, 6 three, 6 two, 6 one; 22 with no reply
  // (14 of them 4 to 5 stars, 8 of them 1 to 3 stars).
  const ratings = [...Array(30).fill(5), ...Array(12).fill(4), ...Array(6).fill(3), ...Array(6).fill(2), ...Array(6).fill(1)];
  let positiveUnanswered = 0;
  let negativeUnanswered = 0;
  return ratings.map((rating, i) => {
    const text = rating >= 4 ? PRAISE[i % PRAISE.length] + (i % 3 === 0 ? ` ${PRAISE[(i + 3) % PRAISE.length]}` : "") : rating === 3 ? MIXED[i % MIXED.length] : COMPLAINTS[i % COMPLAINTS.length];
    const unanswered = rating >= 4 ? i % 3 === 0 && positiveUnanswered++ < 14 : negativeUnanswered++ < 8;
    return {
      id: `a-review-${String(i).padStart(2, "0")}`,
      restaurant_id: IDS.A,
      author_name: AUTHORS[i % AUTHORS.length],
      rating,
      text,
      review_date: new Date(Date.UTC(2026, 9, 30) - i * 3 * 86_400_000).toISOString(),
      replied: !unanswered,
      reply_text: unanswered ? null : "Thank you for your review!",
      handled_at: "2026-10-31T10:00:00Z",
      claimed_at: null,
      source: "dummy",
    };
  });
}

export function siteCReviews() {
  return ["Best cinnamon buns around, always warm.", "Lovely sourdough and friendly staff.", "Great coffee and the pastries are fresh every day.", "Small but cosy, my favourite bakery in Bow."].map((text, i) => ({
    id: `c-review-${i}`,
    restaurant_id: IDS.C,
    author_name: AUTHORS[i],
    rating: i === 3 ? 4 : 5,
    text,
    review_date: new Date(Date.UTC(2026, 9, 20) - i * 9 * 86_400_000).toISOString(),
    replied: true,
    reply_text: "Thanks so much!",
    handled_at: "2026-10-31T10:00:00Z",
    claimed_at: null,
    source: "dummy",
  }));
}
