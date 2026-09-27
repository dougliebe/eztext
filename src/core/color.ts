/** Small colour helpers (kept dependency-free and framework-agnostic). */

/** Parse `#rgb`, `#rrggbb` into `[r, g, b]`. Falls back to mid grey. */
export function parseHex(hex: string): [number, number, number] {
  const value = hex.trim().replace('#', '');
  if (value.length === 3) {
    return [
      parseInt(value[0] + value[0], 16),
      parseInt(value[1] + value[1], 16),
      parseInt(value[2] + value[2], 16),
    ];
  }
  if (value.length === 6) {
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  }
  return [128, 128, 128];
}

/** `rgba()` string for a hex colour at the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** CSS custom properties for a tool colour, handy for inline `style` objects. */
export function colorVars(hex: string): Record<string, string> {
  return { '--tool-color': hex, '--tool-color-soft': withAlpha(hex, 0.16) };
}

/** Cool → hot ramp used by the preview heatmaps. */
const HEAT_STOPS: Array<[number, string]> = [
  [0, '#3f7fbf'],
  [0.5, '#f0b45c'],
  [1, '#f2617c'],
];

/** Interpolate the heat ramp at `t` (0–1), optionally at a given alpha. */
export function heatColor(t: number, alpha = 1): string {
  const clamped = Math.max(0, Math.min(1, t));

  let rgb: [number, number, number] = parseHex(HEAT_STOPS[HEAT_STOPS.length - 1][1]);
  for (let i = 0; i < HEAT_STOPS.length - 1; i += 1) {
    const [from, colorFrom] = HEAT_STOPS[i];
    const [to, colorTo] = HEAT_STOPS[i + 1];
    if (clamped > to) continue;

    const local = to === from ? 0 : (clamped - from) / (to - from);
    const start = parseHex(colorFrom);
    const end = parseHex(colorTo);
    rgb = [0, 1, 2].map((channel) => Math.round(start[channel] + (end[channel] - start[channel]) * local)) as [
      number,
      number,
      number,
    ];
    break;
  }

  if (alpha >= 1) return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** The ramp as a CSS gradient, for the legend swatch. */
export function heatGradient(): string {
  const stops = HEAT_STOPS.map(([at, color]) => `${color} ${Math.round(at * 100)}%`).join(', ');
  return `linear-gradient(90deg, ${stops})`;
}
