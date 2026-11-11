// DinerAI's look in the app (the visual pass, from the Stitch designs): near-black ink,
// "signal" chartreuse for the one main action and good news, ember for urgent, amber for
// "needs a look"; Geist for words and Geist Mono for numbers and small labels. A light
// version follows the phone's setting. Text follows the phone's text size setting.
import { Platform } from 'react-native';

export const Brand = {
  signal: '#c8f03c', // the accent: the one main action, good news, the selected state
  onSignal: '#0b0c0a', // text on the accent, in both modes
  ember: '#ff7a3d', // urgent: a bad review, an unfilled shift
  amber: '#ffb23d', // needs a look: a flagged check, a warning
};

export const Colors = {
  light: {
    background: '#f7f8f3',
    card: '#ffffff',
    panel: '#f0f2ea', // a box inside a card
    border: '#e0e4d8',
    text: '#0b0c0a',
    textSecondary: '#5b6155',
    tint: '#3d5a00', // a readable "signal" on light backgrounds (links, good news)
    danger: '#b3261e',
    signalSoft: 'rgba(61,90,0,0.10)',
    emberSoft: 'rgba(214,88,30,0.10)',
    amberSoft: 'rgba(200,130,0,0.12)',
    ember: '#c24a12',
    amber: '#9a6400',
  },
  dark: {
    background: '#0b0c0a',
    card: '#151813',
    panel: '#0f110d',
    border: '#262b22',
    text: '#edefe8',
    textSecondary: '#a3a99d',
    tint: Brand.signal,
    danger: '#ff8a80',
    signalSoft: 'rgba(200,240,60,0.12)',
    emberSoft: 'rgba(255,122,61,0.13)',
    amberSoft: 'rgba(255,178,61,0.13)',
    ember: Brand.ember,
    amber: Brand.amber,
  },
} as const;

export type Palette = { [K in keyof (typeof Colors)['light']]: string };

// The font families loaded in the root layout (app/_layout.tsx).
export const Fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_500Medium',
  monoBold: 'GeistMono_600SemiBold',
};

export const Space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 } as const;

// Thumb-sized: at least 44 points (Apple) / 48 dp (Google).
export const TapHeight = Platform.select({ ios: 52, default: 54 });

export const Radius = { card: 20, inner: 14, pill: 999 };

export const MaxWidth = 640; // phones fill the width; tablets get the phone layout, centred and a little wider
