import type { EventLog, InputEvent, ZoomSegment } from '@shared/types'

/**
 * Pure, testable core: turn the recorded input log into a list of smooth,
 * non-overlapping, editable auto-zoom moments. Clicks are the strongest
 * "the user is working here" signal, so clusters of clicks (close in time
 * and space) become one zoom moment focused on their centroid.
 *
 * The compositor handles the actual ease in/hold/ease out within each
 * segment (see ZOOM_RAMP_MS); this module only decides when/where/how much.
 */

/** Default ease-in / ease-out duration applied at each segment edge. */
export const ZOOM_RAMP_MS = 420

export interface ZoomOptions {
  /** Max time gap between clicks to stay in the same cluster. */
  mergeGapMs: number
  /** Max normalized distance from cluster centroid to stay in the cluster. */
  mergeRadius: number
  /** Begin the zoom slightly before the first click. */
  preRollMs: number
  /** Keep holding the zoom this long after the last click. */
  holdMs: number
  /** Never emit a moment shorter than this. */
  minSegmentMs: number
  /** Minimum idle gap between two moments before they're merged. */
  minGapMs: number
  /** Target zoom factor for a moment (1 = none). */
  targetScale: number
}

export const DEFAULT_ZOOM_OPTIONS: ZoomOptions = {
  mergeGapMs: 2500,
  mergeRadius: 0.16,
  preRollMs: 250,
  holdMs: 1100,
  minSegmentMs: 1200,
  minGapMs: 500,
  targetScale: 2.2
}

interface Cluster {
  firstT: number
  lastT: number
  cx: number
  cy: number
  n: number
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(ax - bx, ay - by)
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v
}

let idCounter = 0
function nextId(): string {
  idCounter += 1
  return `z${idCounter}`
}

/** Reset id sequence — used by tests for deterministic output. */
export function _resetZoomIds(): void {
  idCounter = 0
}

/** A crop region expressed in normalized 0..1 coords of the source image. */
export interface NormRegion {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Re-express display-normalized events inside a crop region (also
 * normalized). Events outside the region are dropped. Pure + testable.
 */
export function remapEventsToRegion(
  events: InputEvent[],
  region: NormRegion
): InputEvent[] {
  const out: InputEvent[] = []
  for (const e of events) {
    const x = (e.x - region.x) / region.w
    const y = (e.y - region.y) / region.h
    if (x < 0 || x > 1 || y < 0 || y > 1) continue
    out.push({ ...e, x, y })
  }
  return out
}

export function generateZoomSegments(
  log: EventLog,
  durationMs: number,
  opts: Partial<ZoomOptions> = {},
  region?: NormRegion
): ZoomSegment[] {
  const o: ZoomOptions = { ...DEFAULT_ZOOM_OPTIONS, ...opts }

  const events = region
    ? remapEventsToRegion(log.events, region)
    : log.events
  const clicks: InputEvent[] = events
    .filter((e) => e.type === 'down')
    .sort((a, b) => a.t - b.t)

  if (clicks.length === 0) return []

  // 1. Cluster clicks by time + space proximity.
  const clusters: Cluster[] = []
  let cur: Cluster | null = null
  for (const c of clicks) {
    if (
      cur &&
      c.t - cur.lastT <= o.mergeGapMs &&
      dist(c.x, c.y, cur.cx, cur.cy) <= o.mergeRadius
    ) {
      // Running centroid that drifts toward newer clicks.
      cur.cx = (cur.cx * cur.n + c.x) / (cur.n + 1)
      cur.cy = (cur.cy * cur.n + c.y) / (cur.n + 1)
      cur.n += 1
      cur.lastT = c.t
    } else {
      cur = { firstT: c.t, lastT: c.t, cx: c.x, cy: c.y, n: 1 }
      clusters.push(cur)
    }
  }

  // 2. Cluster -> raw timed moment.
  interface Moment {
    start: number
    end: number
    cx: number
    cy: number
    weight: number
  }
  const moments: Moment[] = clusters.map((c) => {
    let start = Math.max(0, c.firstT - o.preRollMs)
    let end = Math.min(durationMs, c.lastT + o.holdMs)
    if (end - start < o.minSegmentMs) {
      end = Math.min(durationMs, start + o.minSegmentMs)
      if (end - start < o.minSegmentMs) {
        start = Math.max(0, end - o.minSegmentMs)
      }
    }
    return { start, end, cx: c.cx, cy: c.cy, weight: c.n }
  })

  // 3. Merge moments that overlap or sit within minGapMs of each other.
  const merged: Moment[] = []
  for (const m of moments) {
    const prev = merged[merged.length - 1]
    if (prev && m.start <= prev.end + o.minGapMs) {
      const w = prev.weight + m.weight
      prev.cx = (prev.cx * prev.weight + m.cx * m.weight) / w
      prev.cy = (prev.cy * prev.weight + m.cy * m.weight) / w
      prev.weight = w
      prev.end = Math.max(prev.end, m.end)
    } else {
      merged.push({ ...m })
    }
  }

  // 4. Emit segments.
  return merged.map((m) => ({
    id: nextId(),
    startMs: Math.round(m.start),
    endMs: Math.round(m.end),
    scale: o.targetScale,
    focusX: clamp01(m.cx),
    focusY: clamp01(m.cy),
    easing: 'easeInOut' as const
  }))
}
