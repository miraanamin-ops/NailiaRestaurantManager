// Every word on the DinerAI landing page (dinerai.co.uk), in one place.
// Edit the text here; the page's components only lay it out.
//
// Rules for this file (tests/site-content.test.ts checks the first two):
// - UK English, plain and confident. No em-dashes or en-dashes.
// - Every made-up number is marked as an example (the "example" fields).
// - Only describe what works today. Anything not built yet says "Coming soon".
//
// {days} is replaced with the free trial length (TRIAL_DAYS, default 14) and
// {price} with the monthly price.

export const site = {
  meta: {
    title: "DinerAI: your AI restaurant manager, on WhatsApp",
    description:
      "DinerAI drafts your review replies, Google posts, offers for quiet nights, a 9am brief and a Monday report. You approve on WhatsApp with one tap. £{price} a month, {days} days free, no contract.",
  },

  nav: [
    { label: "How it works", href: "#how" },
    { label: "Safety", href: "#safety" },
    { label: "Pricing", href: "#pricing" },
    { label: "FAQs", href: "#faqs" },
  ],
  login: "Log in",
  cta: "Start free trial",

  hero: {
    eyebrow: "AI restaurant manager for UK independents",
    headline: ["Your AI restaurant manager.", "15 minutes a week, from WhatsApp."],
    subline:
      "DinerAI drafts the work: replies to your reviews, Google posts, offers for quiet nights, a 9am brief and a Monday report. You approve with one tap. Nothing reaches a customer without your yes.",
    secondary: "See how it works",
    note: "{days} days free, then £{price} a month. No contract, no setup fee.",
    phoneLabel: "Example conversation",
  },

  // The phone in the hero. One loop: the brief arrives, a reply draft appears,
  // the owner taps Approve, the receipt ticks over.
  phone: {
    contact: "DinerAI",
    status: "online",
    time: "09:00",
    brief: {
      title: "Good morning, Aisha. 3 things for you today:",
      items: ["Reply to Sarah's 5 star review", "Thursday offer for your list", "Google post: lamb chops"],
      done: "Done for you yesterday: 6 new sign-ups welcomed.",
    },
    draft: {
      label: "Draft 1 of 3 · review reply",
      review: "“Best mixed grill in East London. Staff were lovely with our kids.”",
      reviewer: "Sarah M. · 5 stars",
      reply:
        "Thank you, Sarah. We're so glad the mixed grill hit the spot and that the kids had a good time. See you all again soon. Aisha, Ember & Spice",
      checks: ["Tone", "Facts", "Compliance", "Money"],
    },
    buttons: ["Approve", "Edit", "Skip"],
    approved: "Approve",
    receipt: "Approved 09:02 · reply ready to post on Google",
    next: "Next: Thursday offer",
  },

  problem: {
    eyebrow: "The problem",
    title: "You run the kitchen, the floor and the books. Marketing gets whatever is left of the night.",
    body: "Service ends, the doors close, and the second shift starts: reviews to answer, a post you meant to write, an offer for the quiet night, last week's takings. It happens on your phone, at midnight, when you are tired.",
    dayLabel: "A typical day",
    day: [
      { time: "07:00", label: "Deliveries", kind: "work" },
      { time: "10:00", label: "Prep", kind: "work" },
      { time: "12:00", label: "Lunch service", kind: "service" },
      { time: "17:00", label: "Dinner service", kind: "service" },
      { time: "23:30", label: "Close", kind: "work" },
    ],
    pile: ["Reply to 4 reviews", "Write a Google post", "Plan Thursday's offer", "Check the takings", "Email the regulars"],
    pileLabel: "After midnight",
    pileExample: "Example",
  },

  how: {
    eyebrow: "How it works",
    title: "Three steps. The first one takes about 20 minutes.",
    steps: [
      {
        tag: "Step 1 · about 20 min",
        title: "Set up once",
        body: "We find you on Google, read your menu from a photo and learn how you sound from your website. You check it, change anything, and link your WhatsApp.",
        ui: ["Found on Google", "Menu read from a photo", "Your voice picked", "Sign-up reward set", "WhatsApp linked"],
      },
      {
        tag: "Step 2 · every day",
        title: "It drafts the work",
        body: "Review replies, Google posts, offers for quiet nights and birthday emails, written in your voice and checked before you see them. Routine drafts wait for your 9am brief; urgent things come straight away.",
        ui: ["Review reply", "Google post", "Thursday offer", "Birthday email"],
      },
      {
        tag: "Step 3 · one tap",
        title: "You approve on WhatsApp",
        body: "Approve, Edit or Skip. Approve everything at once with APPROVE ALL. Edits and skip reasons teach it your tone.",
        ui: ["Approve", "Edit", "Skip"],
      },
    ],
  },

  outcomes: {
    eyebrow: "What you get",
    title: "Less admin. More regulars. Your numbers before service.",
    counterLabel: "Done for you this week",
    counter: [
      { value: 14, label: "review replies" },
      { value: 2, label: "Google posts" },
      { value: 1, label: "email campaign" },
      { value: 7, label: "morning briefs" },
    ],
    example: "Example",
    items: [
      {
        title: "Better reviews",
        body: "A reply to every review in your voice: paste one in and get a reply ready to post. After a reward is used, customers get a “How was your visit?” email with your Google review link. Unhappy answers reach you privately, straight away.",
        readout: { label: "Reviews replied", value: "14 / 14" },
      },
      {
        title: "Fuller quiet nights",
        body: "Text “Thursday is quiet” and get a finished offer, inside your discount cap, ready to send to the customers who signed up. You see a picture of the email before you approve.",
        readout: { label: "Thursday offer redeemed", value: "31 of 214" },
      },
      {
        title: "More repeat customers",
        body: "A QR code on every table signs diners up with a welcome reward. A birthday email is drafted each week. Every customer confirms their email and can unsubscribe in one tap.",
        readout: { label: "New sign-ups this month", value: "86" },
      },
      {
        title: "Your numbers every morning",
        body: "Send a photo of last night's till report, or upload your POS export. Sales land in your 9am brief and your Monday report, compared with last week.",
        readout: { label: "Yesterday, net", value: "£2,340 ▲6%" },
      },
      {
        title: "Less admin",
        body: "One brief at 9am with everything waiting, not a stream of pings. Two Google posts a week drafted from your photos. A Monday report you can read in two minutes.",
        readout: { label: "Taps to approve the brief", value: "1" },
      },
    ],
    soonLabel: "Coming soon",
    soon: ["Automatic Google sync", "Instagram posts"],
  },

  safety: {
    eyebrow: "Safety and control",
    title: "Nothing goes out without your yes.",
    body: "Every draft passes four checks before it reaches you, and again before it sends. If something is wrong, it is fixed or flagged, never sent.",
    gateLabel: "Checker",
    gateChecks: ["Brand and tone", "Facts", "Compliance", "Money and risk"],
    cards: [
      { title: "Review reply", detail: "Sarah M. · 5 stars", ok: true },
      { title: "Google post", detail: "Lamb chops, Friday", ok: true },
      { title: "Offer: 40% off all mains", detail: "Held: over your 15% cap", ok: false },
      { title: "Birthday email", detail: "9 customers", ok: true },
    ],
    controls: [
      { key: "Approve", text: "Nothing reaches a customer until you tap it." },
      { key: "PAUSE", text: "Stops everything going out. RESUME starts it again." },
      { key: "UNDO", text: "Takes back your last change." },
      { key: "Cap", text: "Your maximum discount. Offers above it are held, not sent." },
      { key: "9am to 9pm", text: "Customer emails only go out in sending hours." },
      { key: "Export", text: "Your customer list is yours. Download it as a spreadsheet any time." },
    ],
    footnote:
      "Customers only hear from you if they ticked the box and confirmed their email. Every email has Unsubscribe and Delete my data. The AI never sees your customers' contact details.",
  },

  report: {
    eyebrow: "Every Monday",
    title: "Your week on one page, before you've had your coffee.",
    body: "Reviews, customers, campaigns, Google and sales, last week against the week before, with three things to do next. Open it from WhatsApp or download the PDF.",
    stamp: "Example report · made-up numbers",
    restaurant: "Ember & Spice Grill",
    week: "Week of 5 October",
    headline: "Your best week since August: Friday's offer filled the quiet early tables.",
    kpis: [
      { label: "Net sales", value: "£14,206", change: "+8%" },
      { label: "Average rating", value: "4.7", change: "+0.1" },
      { label: "New sign-ups", value: "23", change: "+5" },
      { label: "Offers redeemed", value: "31", change: "+12" },
    ],
    chartLabel: "Net sales by day",
    days: [
      { day: "Mon", value: 1420, last: 1380 },
      { day: "Tue", value: 1510, last: 1460 },
      { day: "Wed", value: 1690, last: 1610 },
      { day: "Thu", value: 2080, last: 1640 },
      { day: "Fri", value: 2810, last: 2590 },
      { day: "Sat", value: 3010, last: 2900 },
      { day: "Sun", value: 1690, last: 1600 },
    ],
    thisWeek: "This week",
    lastWeek: "Last week",
    actionsLabel: "Next week's 3 actions",
    actions: ["Repeat Thursday's offer for the 6 to 7pm tables", "Thank the 3 new 5 star reviewers", "Post the new lamb chops photo"],
    actionButton: "Start in WhatsApp",
  },

  pricing: {
    eyebrow: "Pricing",
    title: "One plan. Everything included.",
    price: "£{price}",
    per: "a month",
    trial: "{days} days free",
    points: [
      "No contract. Cancel any time and keep it until the end of the month you've paid for.",
      "No setup fee.",
      "Card needed to start. Cancel before your free trial ends and you pay nothing.",
      "Review replies, Google posts, email offers, birthday emails, the 9am brief, the Monday report and sales from your till reports.",
    ],
    fine: "One plan per restaurant.",
  },

  faqs: {
    eyebrow: "FAQs",
    title: "Questions owners ask",
    items: [
      {
        q: "What if I don't like a draft?",
        a: "Tap Edit and say what to change in your own words, or Skip it and say why. Your edits and reasons teach it how you like things. Nothing goes out until you approve it.",
      },
      {
        q: "We're halal, and allergens matter. How is that handled?",
        a: "You write your halal statement and allergen wording once, in settings, and replies use your words. Allergens read from your menu are only suggestions: customers never see them, and messages never mention them, until you confirm each dish.",
      },
      {
        q: "What languages does it work in?",
        a: "English today, for you and your customers. Talking to you in your own language is coming soon.",
      },
      {
        q: "Who owns my data?",
        a: "You do. Your customer list is yours and you can download it any time. Customers can unsubscribe or delete their details from any email. We never sell anyone's data, and the AI is never given your customers' contact details.",
      },
      {
        q: "How do I cancel?",
        a: "Settings, then Manage billing, then Cancel. No phone call, no fee. You keep DinerAI until the end of the month you've paid for. Cancel during the free trial and you pay nothing.",
      },
      {
        q: "What do I need to start?",
        a: "A phone with WhatsApp, your menu (a photo is fine) and about 20 minutes. It helps if your restaurant is on Google. While we're in pilot, you send our WhatsApp number one short message to connect.",
      },
    ],
  },

  final: {
    title: "Get your evenings back.",
    body: "Set up in about 20 minutes. {days} days free. Cancel any time.",
  },

  // The sign-up page (/start on the app domain).
  signup: {
    title: "Start your free trial",
    intro: "About a minute here. Then we do the hard work: finding you on Google, reading your menu and learning how you sound.",
    inviteTitle: "Sign-ups are by invite right now",
    inviteIntro: "We're onboarding a small group of restaurants first. If you have a pilot code, enter it below. If not, email us and we'll let you know when places open.",
    fields: {
      ownerName: "Your name",
      email: "Your email",
      restaurantName: "Restaurant name",
      whatsapp: "Your mobile (for WhatsApp)",
      whatsappHint: "DinerAI runs on WhatsApp: drafts, approvals and your 9am brief.",
      invite: "Pilot invite code",
      inviteOptional: "(optional)",
      inviteHint: "Have a pilot code? No card needed.",
      terms: "I agree to the Terms and have read the Privacy notice.",
    },
    submit: "Continue to card details",
    submitInvite: "Start setting up",
    pendingCheckout: "Opening secure checkout…",
    pendingInvite: "Setting you up…",
    after: "Next, Stripe asks for your card. You won't be charged until your {days} day free trial ends, and you can cancel before then.",
    steps: ["Your details", "Card on Stripe, {days} days free", "Login link by email", "Set up in about 20 minutes"],
    stepsLabel: "What happens next",
    pilotStep: "Pilot code: no card needed",
    reassurance: ["£{price} a month after the trial", "No contract, no setup fee", "Cancel any time in settings"],
    cancelled: "No problem, nothing was charged. Your details are saved: press the button again whenever you're ready.",
    sentTitle: "Check your email",
    sentBody: "We've sent you a login link. Open it on this phone and you'll go straight to setting up.",
    paidTitle: "You're in. Your free trial has started.",
    errors: {
      missing: "Please fill in your name and your restaurant's name.",
      email: "That doesn't look like an email address.",
      whatsapp: "Please check your mobile number (e.g. 07700 900123).",
      terms: "Please tick the box to agree to the Terms.",
      invite: "That invite code isn't valid, or has been used up. Check it, or leave the box empty.",
      invite_only: "Sign-ups are by invite only right now. Enter your pilot code, or email us.",
      wait: "Too many login emails just now. Please wait a minute and try again.",
      send: "Couldn't send the login email. Please try again.",
      captcha: "Please complete the “I'm human” check and try again.",
      slow: "Too many sign-ups from this connection just now. Please try again later.",
      billing: "We couldn't open the card page just now. Please try again in a minute.",
      checkout: "We couldn't confirm your card details with Stripe. If you finished, check your email; otherwise try again.",
    } as Record<string, string>,
  },

  footer: {
    // PLACEHOLDERS: replace with the real company details before launch.
    company: "[COMPANY NAME LTD]",
    companyNumber: "Company number [00000000]",
    office: "Registered office: [ADDRESS]",
    privacy: "Privacy",
    terms: "Terms",
    contact: "Contact",
  },
} as const;

// Fills in {days} and {price}.
export function fill(text: string, values: { days: number; price: number }) {
  return text.replaceAll("{days}", String(values.days)).replaceAll("{price}", String(values.price));
}
