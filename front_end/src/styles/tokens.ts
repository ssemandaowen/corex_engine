/**
 * Helper to get computed CSS variable values at runtime for Canvas, SVG, or Chart libraries.
 */
export function getToken(name: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return '#000000';
  }
  const varName = name.startsWith('--') ? name : `--${name}`;
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}
