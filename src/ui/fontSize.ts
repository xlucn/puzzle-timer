/*
 * fontSize.ts — a font size the user can change, expressed in GTK4 CSS.
 *
 * GTK4 CSS has no custom properties, so a size that comes from a preference
 * cannot be a style class baked into a sheet at import time. The next cheapest
 * thing is one tiny inline sheet per selector that owns a dynamic size,
 * swapped when the number changes: the new sheet is installed before the old
 * one is removed, so no frame is ever painted at a size nobody asked for.
 */
import { styles, type StyleSheet } from 'node-gtk/styles'

/**
 * A setter for `selector`'s font size in px. The same size is a no-op, so it
 * is safe to call from every layout pass.
 *
 * The sheet is not watched for hot-reload (`watch: false`): its source is a
 * number from the running app, not code the watcher could re-import.
 */
export function createFontSize(selector: string): (px: number) => void {
  let sheet: StyleSheet | null = null
  let current = -1
  return (px: number): void => {
    if (!Number.isFinite(px) || px <= 0) return
    const size = Math.round(px * 100) / 100
    if (size === current) return
    current = size
    const previous = sheet
    sheet = styles.add(`${selector} { font-size: ${size}px; }`, { watch: false })
    previous?.remove()
  }
}
