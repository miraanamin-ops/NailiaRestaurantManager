// DinerAI's look in the app: the same near-black and "signal" chartreuse as the
// website and dashboard (src/app/globals.css in the web app), with a light version
// that follows the phone's setting. Text follows the phone's text size setting.
import { Platform } from 'react-native';

export const Brand = {
  signal: '#c8f03c', // the accent: main buttons, the selected tab
  onSignal: '#0b0c0a', // text on the accent, in both modes
  ember: '#ff7a3d', // warnings, used sparingly
};

export const Colors = {
  light: {
    background: '#f7f8f3',
    card: '#ffffff',
    border: '#e0e4d8',
    text: '#0b0c0a',
    textSecondary: '#5b6155',
    tint: '#3d5a00', // a readable "signal" on light backgrounds (links, the selected tab)
    danger: '#b3261e',
  },
  dark: {
    background: '#0b0c0a',
    card: '#171a14',
    border: '#2c3127',
    text: '#edefe8',
    textSecondary: '#a3a99d',
    tint: Brand.signal,
    danger: '#ff8a80',
  },
} as const;

export type Palette = { [K in keyof (typeof Colors)['light']]: string };

export const Space = { xs: 4, s: 8, m: 16, l: 24, xl: 32 } as const;

// Thumb-sized: at least 44 points (Apple) / 48 dp (Google).
export const TapHeight = Platform.select({ ios: 50, default: 52 });

export const MaxWidth = 560; // phones fill the width; tablets get a centred column
