import { desktopCapturer, screen } from 'electron'
import type { CaptureSource, DisplayInfo } from '@shared/types'

/**
 * Enumerate capturable sources: every whole screen (paired with its Electron
 * Display so we know true pixel bounds + DPI for exact cursor→zoom mapping)
 * and every individual application window (no bounds — auto-zoom is
 * best-effort there). Each source carries a thumbnail for the picker.
 */
export async function getSources(): Promise<CaptureSource[]> {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 200 },
    fetchWindowIcons: false
  })
  const displays = screen.getAllDisplays()
  const primaryId = screen.getPrimaryDisplay().id

  const screens: CaptureSource[] = []
  const windows: CaptureSource[] = []
  let screenIdx = 0

  for (const source of sources) {
    const isScreen = source.id.startsWith('screen:')
    const thumbnail = source.thumbnail.isEmpty()
      ? ''
      : source.thumbnail.toDataURL()

    if (isScreen) {
      const matched =
        displays.find((d) => String(d.id) === source.display_id) ??
        displays[screenIdx] ??
        screen.getPrimaryDisplay()
      screenIdx += 1
      const { bounds, scaleFactor } = matched
      const display: DisplayInfo = {
        sourceId: source.id,
        displayId: matched.id,
        name: source.name || `Display ${screenIdx}`,
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height
        },
        scaleFactor,
        pixelSize: {
          width: Math.round(bounds.width * scaleFactor),
          height: Math.round(bounds.height * scaleFactor)
        },
        isPrimary: matched.id === primaryId
      }
      screens.push({
        sourceId: source.id,
        kind: 'screen',
        name: display.isPrimary
          ? `${display.name} (primary)`
          : display.name,
        thumbnail,
        display
      })
    } else if (source.name) {
      windows.push({
        sourceId: source.id,
        kind: 'window',
        name: source.name,
        thumbnail
      })
    }
  }

  return [...screens, ...windows]
}
