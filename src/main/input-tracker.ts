import { screen } from 'electron'
import type { InputEvent } from '@shared/types'
import { EventSink } from './event-sink'
import { assertInsideRecordings } from './storage'

/**
 * Wraps uiohook-napi (global mouse hooks). Isolated here because it is the
 * only fragile native dependency. If the native module fails to load we fall
 * back to a polling tracker that uses Electron's screen.getCursorScreenPoint()
 * (loses click events, so zoom is weaker but the app still works).
 */

interface Tracker {
  start(
    displayId: number,
    eventsPath: string
  ): { tracked: boolean; t0EpochMs: number }
  /** Resolves with the total number of events streamed to disk. */
  stop(): Promise<number>
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
  private sink = new EventSink()
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
    this.sink.push({ t, type, x, y, button })
  }

  start(
    displayId: number,
    eventsPath: string
  ): { tracked: boolean; t0EpochMs: number } {
    this.sink.start(eventsPath)
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

  async stop(): Promise<number> {
    if (this.running) {
      try {
        this.uio.stop()
      } catch {
        /* ignore */
      }
      this.uio.removeAllListeners()
      this.running = false
    }
    return this.sink.finalize()
  }
}

class PollingTracker implements Tracker {
  private sink = new EventSink()
  private t0 = 0
  private box: DisplayPixelBox = { x: 0, y: 0, w: 1, h: 1 }
  private timer: NodeJS.Timeout | null = null

  start(
    displayId: number,
    eventsPath: string
  ): { tracked: boolean; t0EpochMs: number } {
    this.sink.start(eventsPath)
    this.box = displayPixelBox(displayId)
    this.t0 = Date.now()
    this.timer = setInterval(() => {
      const p = screen.getCursorScreenPoint()
      const s =
        (screen.getDisplayNearestPoint(p).scaleFactor || 1)
      const x = (p.x * s - this.box.x) / this.box.w
      const y = (p.y * s - this.box.y) / this.box.h
      if (x < 0 || x > 1 || y < 0 || y > 1) return
      this.sink.push({ t: Date.now() - this.t0, type: 'move', x, y })
    }, 33)
    return { tracked: true, t0EpochMs: this.t0 }
  }

  async stop(): Promise<number> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    return this.sink.finalize()
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

export async function startInputTracking(
  displayId: number,
  eventsPath: string
): Promise<{ ok: boolean; tracked: boolean; t0EpochMs: number }> {
  assertInsideRecordings(eventsPath)
  if (active) {
    try {
      await active.stop()
    } catch {
      /* a dangling tracker shouldn't block a new recording */
    }
  }
  active = makeTracker()
  const { tracked, t0EpochMs } = active.start(displayId, eventsPath)
  return { ok: true, tracked, t0EpochMs }
}

export async function stopInputTracking(): Promise<{ eventCount: number }> {
  if (!active) return { eventCount: 0 }
  const t = active
  active = null
  const eventCount = await t.stop()
  return { eventCount }
}
