// One draft as a card (phase 1): what it is, the review it answers, the words that
// would go out, a picture of an email, the four checks, and what Approve does.
// Swipe right to approve, left to skip; or use the buttons underneath (InboxScreen).
import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Card, T, usePalette } from '@/components/ui';
import { Brand, Space } from '@/constants/theme';
import type { CardCheck, InboxCard } from '@/lib/api';

const ICON: Record<CardCheck['status'], string> = { pass: '✓', fixed: '✓', flagged: '!', failed: '?', held: '…', blocked: '×' };

function Stars({ rating }: { rating: number }) {
  return (
    <T accessibilityLabel={`${rating} out of 5 stars`} style={{ color: rating <= 3 ? Brand.ember : undefined }}>
      {'★'.repeat(rating)}
      {'☆'.repeat(5 - rating)}
    </T>
  );
}

export function DraftCardBody({ card }: { card: InboxCard }) {
  const c = usePalette();
  return (
    <Card accent={card.urgent} style={styles.card}>
      <View style={styles.row}>
        <T kind="label" quiet style={{ flex: 1 }}>
          {card.kindLabel}
        </T>
        {card.urgent && (
          <T kind="label" style={{ color: Brand.ember }}>
            Urgent
          </T>
        )}
      </View>
      <T kind="heading">{card.title}</T>
      {card.review && (
        <View style={[styles.quote, { borderColor: c.border }]}>
          <Stars rating={card.review.rating} />
          <T kind="small" quiet style={{ fontStyle: 'italic' }} numberOfLines={6}>
            {card.review.text ? `“${card.review.text}”` : '(rating only, no words)'}
          </T>
        </View>
      )}
      {card.previewImageUrl ? (
        <Image source={{ uri: card.previewImageUrl }} style={styles.preview} contentFit="contain" accessibilityLabel="How the email will look" />
      ) : null}
      {card.actions !== 'answer' && card.review && (
        <T kind="label" quiet>
          Our reply
        </T>
      )}
      <T>{card.body}</T>
      {card.checks.length > 0 && (
        <View style={styles.checks}>
          {card.checks.map((ch) => {
            const warn = ch.status === 'flagged' || ch.status === 'blocked' || ch.status === 'failed';
            return (
              <View key={ch.name} style={[styles.chip, { borderColor: warn ? Brand.ember : c.border }]}>
                <T kind="small" style={{ color: warn ? Brand.ember : c.textSecondary }}>
                  {ICON[ch.status]} {ch.label}
                </T>
              </View>
            );
          })}
        </View>
      )}
      {card.checks
        .filter((ch) => ch.notes.length && (ch.status === 'flagged' || ch.status === 'blocked'))
        .map((ch) => (
          <T key={ch.name} kind="small" style={{ color: Brand.ember }}>
            {ch.label}: {ch.notes.join(' ')}
          </T>
        ))}
      {card.actions !== 'answer' && (
        <T kind="small" quiet>
          Approve: {card.approveHint.charAt(0).toLowerCase() + card.approveHint.slice(1)}.
        </T>
      )}
    </Card>
  );
}

// The swipeable wrapper. onApprove / onSkip are called after the card has flown off.
export function SwipeableCard({ card, onApprove, onSkip, enabled }: { card: InboxCard; onApprove: () => void; onSkip: () => void; enabled: boolean }) {
  const { width } = useWindowDimensions();
  const threshold = Math.min(140, width * 0.3);
  const x = useSharedValue(0);

  const pan = usePanGesture({
    enabled,
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onUpdate: (e) => {
      x.value = e.translationX;
    },
    onDeactivate: (e) => {
      const go = x.value > threshold || e.velocityX > 900 ? 1 : x.value < -threshold || e.velocityX < -900 ? -1 : 0;
      if (go === 0) {
        x.value = withSpring(0);
        return;
      }
      x.value = withTiming(go * width * 1.2, { duration: 180 }, (finished) => {
        if (finished) scheduleOnRN(go === 1 ? onApprove : onSkip);
      });
    },
  });

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { rotate: `${interpolate(x.value, [-width, 0, width], [-8, 0, 8])}deg` }],
  }));
  const approveTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [0, threshold], [0, 1], 'clamp') }));
  const skipTint = useAnimatedStyle(() => ({ opacity: interpolate(x.value, [-threshold, 0], [1, 0], 'clamp') }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={style}>
        <DraftCardBody card={card} />
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampLeft, { borderColor: Brand.signal }, approveTint]}>
          <T kind="label" style={{ color: Brand.signal }}>
            Approve
          </T>
        </Animated.View>
        <Animated.View pointerEvents="none" style={[styles.stamp, styles.stampRight, { borderColor: Brand.ember }, skipTint]}>
          <T kind="label" style={{ color: Brand.ember }}>
            Skip
          </T>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  card: { gap: Space.s + 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  quote: { borderLeftWidth: 3, paddingLeft: Space.s + 2, gap: 2 },
  preview: { width: '100%', aspectRatio: 0.75, borderRadius: 12 },
  checks: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs + 2 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: Space.s, paddingVertical: 2 },
  stamp: { position: 'absolute', top: Space.m, borderWidth: 2, borderRadius: 8, paddingHorizontal: Space.s, paddingVertical: 2 },
  stampLeft: { left: Space.m },
  stampRight: { right: Space.m },
});
