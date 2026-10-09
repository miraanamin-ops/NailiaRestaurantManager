// What Claude is told about the restaurant's reviews and customers. Instead of
// every review and customer on every message, it gets short summaries, plus
// look-up tools for the specific reviews or customers a message is about.
// Customer emails and phone numbers are never sent. Plain code, unit-tested.

export type ReviewRow = { id: string; author_name: string; rating: number; text: string | null; review_date: string; replied: boolean; reply_text: string | null };
export type CustomerRow = {
  id: string;
  name: string;
  birthday: string | null;
  visit_count: number;
  last_visit: string | null;
  marketing_opt_in: boolean;
  unsubscribed_at?: string | null;
  notes: string | null;
  email?: string | null;
};

const DAY = 24 * 60 * 60 * 1000;
export const LOOKUP_MAX = 10;

export function reviewSummary(reviews: ReviewRow[], now: Date) {
  const recent = reviews.filter((r) => now.getTime() - new Date(r.review_date).getTime() <= 30 * DAY);
  const avg = (list: ReviewRow[]) => (list.length ? Math.round((list.reduce((s, r) => s + r.rating, 0) / list.length) * 10) / 10 : null);
  return {
    total: reviews.length,
    average_rating: avg(reviews),
    not_replied: reviews.filter((r) => !r.replied).length,
    not_replied_low_rated: reviews.filter((r) => !r.replied && r.rating <= 3).length,
    by_stars: Object.fromEntries([5, 4, 3, 2, 1].map((n) => [n, reviews.filter((r) => r.rating === n).length])),
    last_30_days: { count: recent.length, average_rating: avg(recent) },
  };
}

function daysUntilBirthday(birthday: string | null, now: Date) {
  if (!birthday) return null;
  const [, m, d] = birthday.split("-").map(Number);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let next = Date.UTC(now.getUTCFullYear(), m - 1, d);
  if (next < today) next = Date.UTC(now.getUTCFullYear() + 1, m - 1, d);
  return Math.round((next - today) / DAY);
}

export function customerSummary(customers: CustomerRow[], now: Date) {
  return {
    total: customers.length,
    with_email_consent: customers.filter((c) => c.marketing_opt_in && !c.unsubscribed_at && c.email).length,
    birthdays_next_7_days: customers.filter((c) => {
      const n = daysUntilBirthday(c.birthday, now);
      return n !== null && n < 7;
    }).length,
    visited_last_30_days: customers.filter((c) => c.last_visit && now.getTime() - new Date(c.last_visit).getTime() <= 30 * DAY).length,
  };
}

export type ReviewQuery = { min_rating?: number; max_rating?: number; unreplied_only?: boolean; search?: string; limit?: number };

// Newest first, at most LOOKUP_MAX.
export function lookUpReviews(reviews: ReviewRow[], q: ReviewQuery) {
  const search = q.search?.trim().toLowerCase();
  return reviews
    .filter((r) => (q.min_rating ? r.rating >= q.min_rating : true))
    .filter((r) => (q.max_rating ? r.rating <= q.max_rating : true))
    .filter((r) => (q.unreplied_only ? !r.replied : true))
    .filter((r) => (search ? `${r.author_name} ${r.text ?? ""}`.toLowerCase().includes(search) : true))
    .sort((a, b) => b.review_date.localeCompare(a.review_date))
    .slice(0, Math.min(q.limit ?? LOOKUP_MAX, LOOKUP_MAX))
    .map((r) => ({ id: r.id, author: r.author_name, rating: r.rating, date: r.review_date.slice(0, 10), text: r.text, replied: r.replied, reply: r.reply_text }));
}

export type CustomerQuery = { name?: string; birthday_within_days?: number; limit?: number };

// Never includes email addresses or phone numbers.
export function lookUpCustomers(customers: CustomerRow[], q: CustomerQuery, now: Date) {
  const name = q.name?.trim().toLowerCase();
  return customers
    .filter((c) => (name ? c.name.toLowerCase().includes(name) : true))
    .filter((c) => {
      if (q.birthday_within_days === undefined) return true;
      const n = daysUntilBirthday(c.birthday, now);
      return n !== null && n <= q.birthday_within_days;
    })
    .slice(0, Math.min(q.limit ?? LOOKUP_MAX, LOOKUP_MAX))
    .map((c) => ({
      id: c.id,
      name: c.name,
      birthday: c.birthday,
      visits: c.visit_count,
      last_visit: c.last_visit,
      email_marketing_consent: c.marketing_opt_in && !c.unsubscribed_at,
      notes: c.notes,
    }));
}
