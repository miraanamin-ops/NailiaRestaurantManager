# DinerAI restaurant profile schema

Every restaurant has one profile, stored in the database and versioned. Agents read it as context; only the profile keeper and the owner change it. This file defines the fields. The database schema and validation in code should match it.

## Change rules

| Rule | Meaning |
| --- | --- |
| **Auto** | Profile keeper may update it from clear patterns, then tells the owner in the weekly summary. Owner can undo. |
| **Confirm** | Changes only after the owner says yes to the exact change. |
| **Settings** | Changes only when the owner sets it in the web app settings. No agent can change it. |

**Read by:** GM, Rep (Reputation), Gro (Growth), Vis (Visibility), Ins (Insights). The checker reads every field. **Pilot** = must be filled at onboarding before the restaurant goes live.

## 1. Identity

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `name` | Maison Noor | Confirm | All | Yes |
| `address` | Ilford High Road | Confirm | Vis, Gro | Yes |
| `google_place_id` | from Google connection | Settings | Rep, Vis, Ins | Yes |
| `venue_type` | dine-in, takeaway, delivery | Confirm | Gro, Vis | Yes |
| `cuisine` | Middle Eastern grill, desserts | Confirm | Gro, Vis | Yes |
| `links` | website, booking, ordering | Confirm | Gro, Vis | No |
| `phone` | 020 7946 0000 | Confirm | Rep, Vis | No |

## 2. Owner

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `owner_name` | Bilal | Confirm | GM | Yes |
| `sign_off_name` | Bilal and the team | Confirm | Rep | Yes |
| `language` | English, with Urdu replies welcome | Confirm | GM | Yes |
| `quiet_hours` | 10pm to 8am | Confirm | GM | Yes |
| `how_to_speak_to_me` | short, no small talk | Confirm | GM | No |
| `owner_whatsapp` | owner's WhatsApp (one number until Team access) | Settings | GM | Yes |

## 3. Voice

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `tone_notes` | warm, family-run, proud of the grill | Auto | Rep, Gro, Vis | Yes |
| `greeting` | Salaam | Auto | Rep, Gro | No |
| `words_to_avoid` | cheap, deal | Auto | Rep, Gro, Vis | No |
| `emoji_allowed` | default: up to 2 in posts and campaigns, none in review replies | Confirm | Rep, Gro, Vis | Yes |
| `hashtags_allowed` | captions only | Confirm | Vis | No |

## 4. Facts

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `menu` | items: name, price, description, category, dietary tags, allergens, available | Confirm | Rep, Gro, Vis, Ins | Yes |
| `hours` | regular weekly hours | Confirm | GM, Rep, Gro, Vis, Ins | Yes |
| `special_hours` | Christmas Day closed | Confirm | Rep, Gro, Vis, Ins | No |
| `halal_statement` | owner's exact wording, certifier if any | Confirm | Rep, Gro, Vis | Yes |
| `allergen_statement` | owner's exact wording | Confirm | Rep, Gro, Vis | Yes |
| `complaint_contact` | hello@restaurant.co.uk | Confirm | Rep | Yes |
| `faqs` | the owner's answers to common questions, by topic: halal, parking, delivery, bookings, accessibility, kids, private hire (set up with Dina, step 6) | Confirm | Rep, Gro, Vis | No |
| `busy_and_quiet_times` | quiet Mon to Thu before 7pm | Confirm | Gro, Ins | No |

## 5. Commercial

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `discount_cap` | 20% (percentage only for now) | Settings | Gro (and the gate) | Yes |
| `approved_offer_types` | free add-on, % off, kids eat free | Confirm | Gro | Yes |
| `recovery_offers` | free dessert next visit | Confirm | Rep | Yes |
| `signup_offer` | free dessert on joining | Confirm | GM, Gro | Yes |
| `birthday_offer` | free dessert in birthday week | Confirm | GM, Gro | No |

## 6. Brand kit

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `logo` | file | Confirm | Templates | Yes |
| `colours` | primary, secondary, background | Confirm | Templates | Yes |
| `fonts` | heading, body | Confirm | Templates | No |
| `photo_style` | warm light, close-ups, no people | Confirm | Vis, Gro | No |
| `photo_library` | approved photos with tags | Confirm | Gro, Vis | No |

## 7. Insights

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `sales_target` | weekly net sales target | Confirm | Ins | No |
| `dish_costs` | cost per dish | Confirm | Ins | No |
| `rivals` | up to 5 nearby Google places | Confirm | Ins | No |
| `pos_column_mapping` | saved CSV column map | Confirm | Ins | No |
| `zreport_registered_staff` | staff numbers allowed to send Z-reports | Settings | Ins | No |

## 8. Learning

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `examples` | best approved and edited drafts per type | Auto | Rep, Gro, Vis, GM | No |
| `learned_voice_rules` | rule + evidence decision IDs | Auto | Rep, Gro, Vis | No |
| `dont_suggest` | trend ideas, % off offers | Auto | Gro, Vis | No |

## 9. Controls

| Field | Example | Change | Read by | Pilot |
| --- | --- | --- | --- | --- |
| `trust_levels` | per task: Draft only, Approve, Auto | Settings | Gate | Yes |
| `send_window` | 9am to 9pm | Settings | Gate | Yes |
| `paused` | false | Settings or PAUSE | Gate | Yes |

## Never in the profile

- Any individual customer's details. Those live in the customers table with consent records.
- Staff personal details beyond a first name the owner chooses to share.
- Anything about the owner unrelated to running the restaurant.

## Versioning

- Every change writes a new version with: field, old value, new value, who changed it (owner, profile keeper, settings), evidence, timestamp.
- "Undo" restores the previous version of that field only.
- Agents always read the current version. Drafts record the profile version they were made with.
