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

/** Blend two hex colours: `t` = 0 returns `a`, `t` = 1 returns `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const from = parseHex(a);
  const to = parseHex(b);
  const channels = [0, 1, 2].map((channel) =>
    Math.round(from[channel] + (to[channel] - from[channel]) * clamped),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * WCAG relative luminance.
 *
 * Linearise each sRGB channel, then weight by the eye's sensitivity. Used to
 * prove that a highlight is still legible under dark text.
 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between any two colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * How far a shade may travel from `base` toward `target` before `ink` drops
 * below `minimum` contrast.
 *
 * Binary search rather than algebra: the sRGB transfer function makes luminance
 * non-linear in the mix factor, so there is no closed form worth writing.
 * `minimum` of 4.5 is WCAG AA for body text, 3.0 for large text.
 */
export function maxMixForContrast(base: string, target: string, ink: string, minimum = 4.5): number {
  let safe = 0;
  let unsafe = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (safe + unsafe) / 2;
    if (contrastRatio(mixHex(base, target, mid), ink) >= minimum) safe = mid;
    else unsafe = mid;
  }
  return safe;
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

