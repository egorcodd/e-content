import type { Point } from '../features/analytics/chart-model';
const spike = (t: number, from: number, to: number, value: number) =>
  t > from && t < to ? value : 0;
export const samples: Point[] = Array.from({ length: 180 }, (_, t) => ({
  date: new Date(Date.UTC(2026, 4, 20 + t)).toISOString(),
  telegram: {
    followers: Math.round(9100 + t * 13 + Math.sin(t / 8) * 60),
    views: Math.round(
      1700 + t * 6 + Math.sin(t / 4) * 380 + Math.cos(t / 9) * 210 + spike(t, 154, 162, 1000),
    ),
    comments: Math.max(
      0,
      Math.round(
        18 +
          t * 0.2 +
          Math.sin(t / 4) * 10 +
          spike(t, 154, 162, 26) -
          (t > 170 ? (t - 170) * 4 : 0),
      ),
    ),
    reactions: Math.round(130 + t * 0.8 + Math.sin(t / 4) * 35 + spike(t, 154, 162, 95)),
    shares: Math.round(32 + t * 0.22 + Math.sin(t / 6) * 12 + spike(t, 154, 162, 32)),
  },
  tiktok: {
    followers: Math.round(1200 + t * 11 + Math.sin(t / 7) * 55),
    views: Math.round(
      3000 +
        t * 10 +
        Math.sin(t / 5 + 0.8) * 1500 +
        Math.cos(t / 9) * 420 +
        spike(t, 154, 163, 2600),
    ),
    comments: Math.max(
      0,
      Math.round(
        35 +
          t * 0.3 +
          Math.sin(t / 5) * 16 +
          spike(t, 154, 163, 38) -
          (t > 170 ? (t - 170) * 5 : 0),
      ),
    ),
    reactions: Math.round(250 + t * 1.4 + Math.sin(t / 5) * 115 + spike(t, 154, 163, 320)),
    shares: Math.round(48 + t * 0.35 + Math.sin(t / 5) * 20 + spike(t, 154, 163, 62)),
  },
}));
