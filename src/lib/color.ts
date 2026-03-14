import { readableColor } from 'color2k';

/**
 * Given a 6-character hex color (no leading #), returns 'black' or 'white'
 * whichever produces the higher WCAG contrast ratio against that background.
 */
export function labelTextColor(hex: string): string {
  if (!hex || hex.length !== 6) return 'black';
  try {
    return readableColor(`#${hex}`);
  } catch {
    return 'black';
  }
}
