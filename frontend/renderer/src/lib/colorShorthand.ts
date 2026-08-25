import type { ColorQty } from '@renderer/components/features/types'

// "black10+pink20" — the shorthand wholesale staff already write by hand for a color
// breakdown. Each "+"-separated chunk is a color name immediately followed by its qty;
// split on the last run of digits so a multi-word color like "light blue10" still works.
export function parseColorShorthand(text: string): ColorQty[] {
  return text
    .split('+')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const match = chunk.match(/^(.*?)(\d+)$/)
      return match ? { color: match[1].trim(), qty: Number(match[2]) } : { color: chunk, qty: 0 }
    })
}

export function formatColorShorthand(colors: ColorQty[]): string {
  return colors.map((c) => `${c.color}${c.qty}`).join('+')
}

export function colorShorthandTotal(text: string): number {
  return parseColorShorthand(text).reduce((sum, c) => sum + (Number(c.qty) || 0), 0)
}
