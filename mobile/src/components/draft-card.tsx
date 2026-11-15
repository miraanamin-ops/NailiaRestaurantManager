// One draft as a card (phase 1): what it is, the review it answers, the words that
// would go out and a picture of an email. Checks are one tick, or one amber line when
// something needs the owner (fewer words, 15 Nov).
// Swipe right to approve, left to skip; or use the buttons underneath (InboxScreen).
import { Image } from 'expo-image';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { Card, Icon, Panel, Pill, T, usePalette } from '@/components/ui';
import { Brand, Space } from '@/constants/theme';
import type { InboxCard } from '@/lib/api';

function Stars({ rating }: { rating: number }) {
  const c = usePalette();
  return (
    <T kind="mono" accessibilityLabel={`${rating} out of 5 stars`} style={{ color: rating <= 3 ? c.ember : c.tint }}>
      {'★'.repeat(rating)}
      <T kind="mono" style={{ color: c.border }}>
        {'★'.repeat(5 - rating)}
      </T>
    </T>
  );
}

// bare: without its own card (inside an Inbox row, which is the card).
export function DraftCardBody({ card, bare = false }: { card: InboxCard; bare?: boolean }) {
  const c = usePalette();
  const content = (
    <>
      {!bare && (
        <>
          <View style={styles.row}>
            <T kind="label" quiet style={{ flex: 1 }}>
              {card.kindLabel}
            </T>
            {card.urgent && <Pill label="Urgent" tone="ember" dot />}
          </View>
          <T kind="heading">{card.title}</T>
        </>
      )}
      {card.review && (
        <Panel>
          <View style={styles.row}>
            <T style={{ fontWeight: '600', flex: 1 }}>{card.review.author}</T>
            <Stars rating={card.review.rating} />
          </View>
          <T kind="small" quiet style={{ fontStyle: 'italic' }} numberOfLines={6}>
            {card.review.text ? `“${card.review.text}”` : '(rating only, no words)'}
          </T>
        </Panel>
      )}
      {card.previewImageUrl ? <Image source={{ uri: card.previewImageUrl }} style={styles.preview} contentFit="contain" accessibilityLabel="How the email will look" /> : null}
      {card.actions !== 'answer' && card.review && (
        <View style={styles.row}>
          <Icon name="sparkles-outline" size={14} color={c.tint} />
          <T kind="label" style={{ color: c.tint }}>
            Our reply
          </T>
        </View>
      )}
      <T selectable>{card.body}</T>
      {card.allClear ?? card.checks.every((ch) => ch.status === 'pass' || ch.status === 'fixed') ? (
        card.checks.length > 0 && (
          <View style={styles.row} accessibilityLabel="Checked, all correct">
            <Icon name="checkmark-circle" size={16} color={c.tint} />
            <T kind="caption" style={{ color: c.tint }}>
              Checked
            </T>
          </View>
        )
      ) : (
        <View style={styles.row}>
          <Icon name="alert-circle-outline" size={16} color={c.amber} />
          <T kind="small" style={{ color: c.amber, flex: 1 }}>
            {card.checkLine ?? card.checks.find((ch) => ch.status !== 'pass' && ch.status !== 'fixed')?.notes[0] ?? 'Have a look before you approve.'}
          </T>
        </View>
      )}
    </>
  );
  if (bare) return <View style={styles.card}>{content}</View>;
  return (
    <Card tone={card.urgent ? 'ember' : undefined} style={styles.card}>
      {content}
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
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  preview: { width: '100%', aspectRatio: 0.75, borderRadius: 12 },
  stamp: { position: 'absolute', top: Space.m, borderWidth: 2, borderRadius: 8, paddingHorizontal: Space.s, paddingVertical: 2 },
  stampLeft: { left: Space.m },
  stampRight: { right: Space.m },
});
