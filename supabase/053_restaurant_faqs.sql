-- 053: the answers to the common questions customers ask (Dina's step 6, Hours
-- and FAQs): halal certification, parking, delivery and collection, bookings,
-- accessibility, children, private hire. In the owner's own words, keyed by topic,
-- e.g. {"parking": "Free parking behind the restaurant", "kids": "High chairs and a kids' menu"}.
-- A versioned profile field (src/lib/profile/fields.ts "faqs"), so it can be undone.
-- Safe to re-run.

alter table restaurants add column if not exists faqs jsonb not null default '{}'::jsonb;

insert into schema_migrations (name) values ('053_restaurant_faqs.sql') on conflict (name) do nothing;
