/** Presentation only: render explicit part-local tick positions in the editor's beat vocabulary. */
export function readableMiraAdvice(text: string): string {
  return text.replace(/\bat tick\s+(\d+)\b/gi, (original, digits: string) => {
    const tick = Number(digits)
    if (!Number.isSafeInteger(tick) || tick < 0 || tick >= 256 * 1920) return original
    return `at bar ${Math.floor(tick / 1920) + 1}, beat ${1 + tick % 1920 / 480}`
  })
}
