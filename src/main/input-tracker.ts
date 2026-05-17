import { screen } from 'electron'
import type { EventLog, InputEvent } from '@shared/types'

/**
 * Wraps uiohook-napi (global mouse hooks). Isolated here because it is the
 * only fragile native dependency. If the native module fails to load we fall
 * back to a polling tracker that uses Electron's screen.getCursorScreenPoint()
 * (loses click events, so zoom is weaker but the app still works).
 */

interface Tracker {
  start(displayId: number): { tracked: boolean; t0EpochMs: number }
  stop(): EventLog
}

interface DisplayPixelBox {
  x: number
  y: number
  w: number
  h: number
}

function displayPixelBox(displayId: number): DisplayPixelBox {
  const displays = screen.getAllDisplays()
  const d =
    displays.find((x) => x.id === displayId) ?? screen.getPrimaryDisplay()
  const s = d.scaleFactor || 1
  return {
    x: d.bounds.x * s,
    y: d.bounds.y * s,
    w: Math.max(1, d.bounds.width * s),
    h: Math.max(1, d.bounds.height * s)
  }
}

class UiohookTracker implements Tracker {
  private events: InputEvent[] = []
  private t0 = 0
  private box: DisplayPixelBox = { x: 0, y: 0, w: 1, h: 1 }
  private running = false
  private lastMoveT = -1
  private uio: typeof import('uiohook-napi').uIOhook

  constructor(uio: typeof import('uiohook-napi').uIOhook) {
    this.uio = uio
  }

  private push(
    type: InputEvent['type'],
    rawX: number,
    rawY: number,
    button?: number
  ): void {
    const t = Date.now() - this.t0
    // Throttle moves to ~60Hz to keep the log small.
    if (type === 'move') {
      if (t - this.lastMoveT < 16) return
      this.lastMoveT = t
    }
    const x = (rawX - this.box.x) / this.box.w
    const y = (rawY - this.box.y) / this.box.h
    // Drop events that landed on another monitor.
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    this.events.push({ t, type, x, y, button })
  }

  start(displayId: number): { tracked: boolean; t0EpochMs: number } {
    this.events = []
    this.lastMoveT = -1
    this.box = displayPixelBox(displayId)
    this.t0 = Date.now()

    this.uio.on('mousemove', (e) => this.push('move', e.x, e.y))
    this.uio.on('mousedown', (e) =>
      this.push('down', e.x, e.y, Number(e.button) || 1)
    )
    this.uio.on('mouseup', (e) =>
      this.push('up', e.x, e.y, Number(e.button) || 1)
    )
    this.uio.on('wheel', (e) => this.push('wheel', e.x, e.y))
    this.uio.start()
    this.running = true
    return { tracked: true, t0EpochMs: this.t0 }
  }

  stop(): EventLog {
    if (this.running) {
      try {
        this.uio.stop()
      } catch {
        /* ignore */
      }
      this.uio.removeAllListeners()
      this.running = false
    }
    return { version: 1, events: this.events }
  }
}

class PollingTracker implements Tracker {
  private events: InputEvent[] = []
  private t0 = 0
  private box: DisplayPixelBox = { x: 0, y: 0, w: 1, h: 1 }
  private timer: NodeJS.Timeout | null = null

  start(displayId: number): { tracked: boolean; t0EpochMs: number } {
    this.events = []
    this.box = displayPixelBox(displayId)
    this.t0 = Date.now()
    this.timer = setInterval(() => {
      const p = screen.getCursorScreenPoint()
      const s =
        (screen.getDisplayNearestPoint(p).scaleFactor || 1)
      const x = (p.x * s - this.box.x) / this.box.w
      const y = (p.y * s - this.box.y) / this.box.h
      if (x < 0 || x > 1 || y < 0 || y > 1) return
      this.events.push({ t: Date.now() - this.t0, type: 'move', x, y })
    }, 33)
    return { tracked: true, t0EpochMs: this.t0 }
  }

  stop(): EventLog {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    return { version: 1, events: this.events }
  }
}

let active: Tracker | null = null

function makeTracker(): Tracker {
  try {
    const { uIOhook } = require('uiohook-napi') as typeof import('uiohook-napi')
    return new UiohookTracker(uIOhook)
  } catch (err) {
    console.warn('[input-tracker] uiohook unavailable, polling fallback:', err)
    return new PollingTracker()
  }
}

export function startInputTracking(displayId: number): {
  ok: boolean
  tracked: boolean
  t0EpochMs: number
} {
  if (active) active.stop()
  active = makeTracker()
  const { tracked, t0EpochMs } = active.start(displayId)
  return { ok: true, tracked, t0EpochMs }
}

export function stopInputTracking(): EventLog {
  if (!active) return { version: 1, events: [] }
  const log = active.stop()
  active = null
  return log
}
