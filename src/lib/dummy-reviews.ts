// Pools for the "NEW REVIEW" test command, one per kind of restaurant, so a test
// review always sounds like it's about the restaurant that asked for it.
type DummyReview = { author: string; rating: number; text: string };

const GRILL: DummyReview[] = [
  { author: "Hassan D.", rating: 5, text: "Came for my brother's birthday and the staff brought out kunafa with a candle. Mixed grill was massive. Proper hospitality." },
  { author: "Emily R.", rating: 5, text: "First time trying a halal grill and I'm hooked. The peri peri wings were perfect and the lassi was lovely." },
  { author: "Tariq N.", rating: 4, text: "Lamb chops were spot on as usual. Bit of a wait for the bill but the food makes up for it." },
  { author: "Jess M.", rating: 4, text: "Really good smash burger and masala chips. Seating is a bit tight when it's busy." },
  { author: "Kofi A.", rating: 3, text: "Chicken tikka was tasty but the portion felt smaller than last time. Service was friendly enough." },
  { author: "Ayesha P.", rating: 3, text: "Good food but we waited 25 minutes for drinks on a Friday night. Karak chai was worth it though." },
  { author: "Mark S.", rating: 2, text: "Ordered on Deliveroo and the naan arrived soggy and the wings were lukewarm. Not like eating in." },
  { author: "Nusrat H.", rating: 2, text: "Booked for 8pm and didn't get seated until 8:40. Nobody explained the delay. Food was nice once it came." },
  { author: "Dave K.", rating: 1, text: "Found a hair in my rice and when I mentioned it the waiter just shrugged. Won't be back." },
  { author: "Salma B.", rating: 1, text: "Charged for a lassi we never got and it took ages to sort out. Really put a downer on the evening." },
  { author: "Ollie T.", rating: 5, text: "Best seekh kebabs in Whitechapel. Owner remembered us from last month, which was a lovely touch." },
  { author: "Farzana Q.", rating: 4, text: "Great family spot. Kids loved the wings. Would be 5 stars with a few more veggie mains." },
];

const CAFE: DummyReview[] = [
  { author: "Lucy W.", rating: 5, text: "The cardamom latte is something else. Cosy corner table, friendly staff, I stayed far longer than planned." },
  { author: "Rahim C.", rating: 5, text: "Best masala omelette I've had outside my mum's kitchen. Lovely calm café." },
  { author: "Megan T.", rating: 4, text: "Pistachio rose cake was gorgeous. Only wish they opened on Sundays!" },
  { author: "Sanjay V.", rating: 4, text: "Great halloumi wrap and quick service at lunch. A bit noisy when the school run crowd arrives." },
  { author: "Olivia B.", rating: 3, text: "Nice coffee but the almond croissants had sold out by 10am again." },
  { author: "Kevin O.", rating: 3, text: "Panini was fine, nothing special. Lovely staff though." },
  { author: "Zainab R.", rating: 2, text: "Waited 20 minutes for two drinks on a Saturday and nobody said sorry." },
  { author: "Paul F.", rating: 2, text: "Soup was lukewarm and the bread was stale. Disappointing as I usually love it here." },
  { author: "Hannah G.", rating: 1, text: "Charged twice for my order and it took three visits to get the refund sorted." },
  { author: "Arif M.", rating: 1, text: "Found the café closed at 3pm on a Thursday even though it says open till 7. Wasted trip." },
];

// A random review for this kind of restaurant, optionally with a given star rating.
export function randomDummyReview(rating: number | undefined, cuisine: string | null) {
  const all = /caf[eé]|bakery|coffee/i.test(cuisine ?? "") ? CAFE : GRILL;
  const pool = rating ? all.filter((r) => r.rating === rating) : all;
  return (pool.length ? pool : all)[Math.floor(Math.random() * (pool.length ? pool : all).length)];
}
