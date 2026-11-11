// Which icon stands for each kind of draft (the Inbox's rows, Today's waiting list).
import type { IconName } from '@/components/ui';

const BY_KIND: Record<string, IconName> = {
  review_reply: 'star-outline',
  review_question: 'help-circle-outline',
  email_campaign: 'mail-outline',
  google_post: 'image-outline',
  rota: 'calendar-outline',
  hours_update: 'time-outline',
  hours_question: 'time-outline',
  menu_update: 'restaurant-outline',
  profile_change: 'create-outline',
  profile_fix: 'create-outline',
  agent_question: 'chatbubble-ellipses-outline',
  choice: 'chatbubble-ellipses-outline',
  special_idea: 'bulb-outline',
  import_welcome: 'people-outline',
};

export const kindIcon = (kind: string): IconName => BY_KIND[kind] ?? 'document-text-outline';

// From a title in plain words, when the kind isn't known (Today's short list).
export function titleIcon(title: string): IconName {
  if (/review/i.test(title)) return 'star-outline';
  if (/^email/i.test(title)) return 'mail-outline';
  if (/google post/i.test(title)) return 'image-outline';
  if (/rota/i.test(title)) return 'calendar-outline';
  if (/hours/i.test(title)) return 'time-outline';
  return 'document-text-outline';
}

// By the message type the Inbox groups under (lib/app/cards.ts MESSAGE_TYPES).
const BY_TYPE: Record<string, IconName> = {
  review_good: 'star-outline',
  review_poor: 'star-half-outline',
  birthday_email: 'gift-outline',
  email_offer: 'mail-outline',
};
export const typeIcon = (key: string): IconName => BY_TYPE[key] ?? BY_KIND[key] ?? 'document-text-outline';

// Each category's colour and words, the same on Today's tiles and the Inbox.
export const CATEGORIES = {
  urgent: { title: 'Urgent', tone: 'ember' },
  look: { title: 'Needs a look', tone: 'amber' },
  later: { title: 'Not urgent', tone: 'neutral' },
  simple: { title: 'Simple', tone: 'signal' },
} as const;
export const CATEGORY_ORDER = ['urgent', 'look', 'later', 'simple'] as const;
