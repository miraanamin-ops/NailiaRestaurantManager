// The sun's and moon's positions, low precision (Meeus, Astronomical
// Algorithms, chapters 25 and 47, main terms: the moon to about 0.01 degrees,
// a minute or two of time), for the dates that follow the moon: Diwali here.
// Pure; tested against published dates (tests/feeds-calendar.test.ts).

const RAD = Math.PI / 180;
const norm = (d: number) => ((d % 360) + 360) % 360;
const sin = (d: number) => Math.sin(d * RAD);

// Julian centuries from J2000.0 (the ~70 seconds between TT and UT don't matter here).
const centuries = (ms: number) => (ms / 86_400_000 + 2440587.5 - 2451545.0) / 36525;

export function sunLongitude(ms: number) {
  const T = centuries(ms);
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T;
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T;
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M);
  // Apparent longitude, without nutation (the moon's would carry the same, so differences cancel).
  return norm(L0 + C - 0.00569);
}

// [D, M, M', F, coefficient in millionths of a degree, power of E]
const MOON_TERMS: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6288774, 0], [2, 0, -1, 0, 1274027, 0], [2, 0, 0, 0, 658314, 0], [0, 0, 2, 0, 213618, 0],
  [0, 1, 0, 0, -185116, 1], [0, 0, 0, 2, -114332, 0], [2, 0, -2, 0, 58793, 0], [2, -1, -1, 0, 57066, 1],
  [2, 0, 1, 0, 53322, 0], [2, -1, 0, 0, 45758, 1], [0, 1, -1, 0, -40923, 1], [1, 0, 0, 0, -34720, 0],
  [0, 1, 1, 0, -30383, 1], [2, 0, 0, -2, 15327, 0], [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 0],
  [4, 0, -1, 0, 10675, 0], [0, 0, 3, 0, 10034, 0], [4, 0, -2, 0, 8548, 0], [2, 1, -1, 0, -7888, 1],
  [2, 1, 0, 0, -6766, 1], [1, 0, -1, 0, -5163, 0], [1, 1, 0, 0, 4987, 1], [2, -1, 1, 0, 4036, 1],
  [2, 0, 2, 0, 3994, 0], [4, 0, 0, 0, 3861, 0], [2, 0, -3, 0, 3665, 0], [0, 1, -2, 0, -2689, 1],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 1], [1, 0, 1, 0, -2348, 0], [2, -2, 0, 0, 2236, 2],
  [0, 1, 2, 0, -2120, 1], [0, 2, 0, 0, -2069, 2],
];

export function moonLongitude(ms: number) {
  const T = centuries(ms);
  const Lp = 218.3164477 + 481267.88123421 * T;
  const D = 297.8501921 + 445267.1114034 * T;
  const M = 357.5291092 + 35999.0502909 * T;
  const Mp = 134.9633964 + 477198.8675055 * T;
  const F = 93.272095 + 483202.0175233 * T;
  const E = 1 - 0.002516 * T;
  let sum = 0;
  for (const [d, m, mp, f, c, e] of MOON_TERMS) sum += c * E ** e * sin(d * D + m * M + mp * Mp + f * F);
  sum += 3958 * sin(119.75 + 131.849 * T) + 1962 * sin(Lp - F) + 318 * sin(53.09 + 479264.29 * T);
  return norm(Lp + sum / 1e6);
}

// The moon's angle ahead of the sun, 0 to 360 (0 = new moon). A tithi is 12 degrees of it.
export const elongation = (ms: number) => norm(moonLongitude(ms) - sunLongitude(ms));

// The first instant after `fromMs` (within `withinDays`) when f(t), an angle
// rising through the target (mod 360), reaches it. Steps of 6 hours, then halving.
export function whenAngle(f: (ms: number) => number, target: number, fromMs: number, withinDays: number) {
  const ahead = (ms: number) => norm(f(ms) - target); // just past the target = small
  const step = 6 * 3_600_000;
  let a = fromMs;
  for (let t = fromMs + step; t <= fromMs + withinDays * 86_400_000; t += step) {
    if (ahead(a) >= 180 && ahead(t) < 180) {
      let lo = a;
      let hi = t;
      while (hi - lo > 30_000) {
        const mid = (lo + hi) / 2;
        if (ahead(mid) < 180) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    a = t;
  }
  return null;
}

// Lahiri ayanamsa (degrees): sidereal longitude = tropical - ayanamsa.
export const lahiri = (year: number) => 23.853 + (year - 2000) * 0.013969;
