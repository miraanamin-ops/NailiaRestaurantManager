// Pool for the "NEW REVIEW" test command. Each pick inserts one as a fresh Google review.
const POOL: { author: string; rating: number; text: string }[] = [
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

export function randomDummyReview() {
  return POOL[Math.floor(Math.random() * POOL.length)];
}
