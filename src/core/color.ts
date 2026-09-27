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
