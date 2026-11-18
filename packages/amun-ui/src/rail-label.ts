/**
 * Accessible name for a status-rail button. A visible count must be part of
 * the name, otherwise speech users cannot activate the button by what they see.
 */
export function railLabel(label: string, count = 0): string {
  const whole = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  return whole > 0 ? `${label} drawer, ${whole} active` : `${label} drawer`;
}
