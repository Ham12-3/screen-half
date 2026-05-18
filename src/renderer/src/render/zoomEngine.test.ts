import { describe, expect, it, beforeEach } from 'vitest'
import type { EventLog } from '@shared/types'
import {
  DEFAULT_ZOOM_OPTIONS,
  generateZoomSegments,
  remapEventsToRegion,
  _resetZoomIds
} from './zoomEngine'

function log(events: EventLog['events']): EventLog {
  return { version: 1, events }
}

beforeEach(() => _resetZoomIds())

describe('generateZoomSegments', () => {
  it('returns nothing when there are no clicks', () => {
    const out = generateZoomSegments(
      log([
        { t: 0, type: 'move', x: 0.1, y: 0.1 },
        { t: 100, type: 'move', x: 0.2, y: 0.2 }
      ]),
      5000
    )
    expect(out).toEqual([])
  })

  it('makes one moment from a tight click cluster, focused on its centroid', () => {
    const out = generateZoomSegments(
      log([
        { t: 1000, type: 'down', x: 0.4, y: 0.5, button: 1 },
        { t: 1300, type: 'down', x: 0.42, y: 0.52, button: 1 },
        { t: 1600, type: 'down', x: 0.41, y: 0.51, button: 1 }
      ]),
      8000
    )
    expect(out).toHaveLength(1)
    const s = out[0]
    expect(s.focusX).toBeGreaterThan(0.39)
    expect(s.focusX).toBeLessThan(0.43)
    expect(s.scale).toBe(DEFAULT_ZOOM_OPTIONS.targetScale)
    // Starts slightly before the first click (pre-roll) and not negative.
    expect(s.startMs).toBe(1000 - DEFAULT_ZOOM_OPTIONS.preRollMs)
    expect(s.endMs).toBeGreaterThan(s.startMs)
  })

  it('splits clicks far apart in space into separate moments', () => {
    const out = generateZoomSegments(
      log([
        { t: 1000, type: 'down', x: 0.1, y: 0.1, button: 1 },
        { t: 1200, type: 'down', x: 0.12, y: 0.11, button: 1 },
        { t: 9000, type: 'down', x: 0.9, y: 0.9, button: 1 },
        { t: 9200, type: 'down', x: 0.88, y: 0.92, button: 1 }
      ]),
      15000
    )
    expect(out).toHaveLength(2)
    expect(out[0].focusX).toBeLessThan(0.3)
    expect(out[1].focusX).toBeGreaterThan(0.7)
  })

  it('produces non-overlapping, time-ordered segments', () => {
    const events: EventLog['events'] = []
    for (let i = 0; i < 20; i++) {
      events.push({
        t: i * 800,
        type: 'down',
        x: (i % 2) * 0.8 + 0.1,
        y: 0.5,
        button: 1
      })
    }
    const out = generateZoomSegments(log(events), 20000)
    for (let i = 1; i < out.length; i++) {
      expect(out[i].startMs).toBeGreaterThanOrEqual(out[i - 1].endMs)
    }
  })

  it('clamps segments within [0, durationMs]', () => {
    const out = generateZoomSegments(
      log([{ t: 100, type: 'down', x: 0.5, y: 0.5, button: 1 }]),
      1500
    )
    expect(out[0].startMs).toBeGreaterThanOrEqual(0)
    expect(out[0].endMs).toBeLessThanOrEqual(1500)
  })

  it('enforces a minimum segment duration', () => {
    const out = generateZoomSegments(
      log([{ t: 5000, type: 'down', x: 0.5, y: 0.5, button: 1 }]),
      20000
    )
    expect(out[0].endMs - out[0].startMs).toBeGreaterThanOrEqual(
      DEFAULT_ZOOM_OPTIONS.minSegmentMs
    )
  })

  it('keeps focus coordinates within 0..1', () => {
    const out = generateZoomSegments(
      log([
        { t: 1000, type: 'down', x: 1.4, y: -0.3, button: 1 },
        { t: 1200, type: 'down', x: 1.5, y: -0.2, button: 1 }
      ]),
      5000
    )
    for (const s of out) {
      expect(s.focusX).toBeGreaterThanOrEqual(0)
      expect(s.focusX).toBeLessThanOrEqual(1)
      expect(s.focusY).toBeGreaterThanOrEqual(0)
      expect(s.focusY).toBeLessThanOrEqual(1)
    }
  })

  it('re-targets focus inside a crop region', () => {
    // Region is the right half of the screen: x 0.5..1.0.
    const region = { x: 0.5, y: 0, w: 0.5, h: 1 }
    const out = generateZoomSegments(
      log([
        { t: 1000, type: 'down', x: 0.75, y: 0.5, button: 1 },
        { t: 1300, type: 'down', x: 0.75, y: 0.5, button: 1 }
      ]),
      8000,
      {},
      region
    )
    expect(out).toHaveLength(1)
    // 0.75 in display space → (0.75-0.5)/0.5 = 0.5 in region space.
    expect(out[0].focusX).toBeCloseTo(0.5, 5)
  })

  it('drops events outside the crop region', () => {
    const region = { x: 0.5, y: 0, w: 0.5, h: 1 }
    const out = generateZoomSegments(
      log([{ t: 1000, type: 'down', x: 0.1, y: 0.5, button: 1 }]),
      8000,
      {},
      region
    )
    expect(out).toEqual([])
  })
})

describe('remapEventsToRegion', () => {
  it('normalizes inside-region events and discards outside ones', () => {
    const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }
    const out = remapEventsToRegion(
      [
        { t: 0, type: 'down', x: 0.5, y: 0.5 },
        { t: 1, type: 'move', x: 0.0, y: 0.0 },
        { t: 2, type: 'down', x: 0.75, y: 0.75 }
      ],
      region
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ t: 0, x: 0.5, y: 0.5 })
    expect(out[1].x).toBeCloseTo(1, 5)
    expect(out[1].y).toBeCloseTo(1, 5)
  })
})
