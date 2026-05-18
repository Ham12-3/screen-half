import { describe, expect, it } from 'vitest'
import type { LayoutConfig, ZoomSegment } from '@shared/types'
import { computeRects, currentZoom } from './composite'

const seg = (over: Partial<ZoomSegment> = {}): ZoomSegment => ({
  id: 'z1',
  startMs: 1000,
  endMs: 5000,
  scale: 2.2,
  focusX: 0.3,
  focusY: 0.7,
  easing: 'easeInOut',
  ...over
})

describe('currentZoom', () => {
  it('is identity outside any segment', () => {
    expect(currentZoom([seg()], 200)).toEqual({
      scale: 1,
      fx: 0.5,
      fy: 0.5
    })
  })

  it('holds full scale in the middle of a segment', () => {
    const z = currentZoom([seg()], 3000)
    expect(z.scale).toBeCloseTo(2.2, 5)
    expect(z.fx).toBe(0.3)
    expect(z.fy).toBe(0.7)
  })

  it('eases in from 1 at the start edge', () => {
    const atStart = currentZoom([seg()], 1000)
    expect(atStart.scale).toBeCloseTo(1, 5)
    const mid = currentZoom([seg()], 1200)
    expect(mid.scale).toBeGreaterThan(1)
    expect(mid.scale).toBeLessThan(2.2)
  })

  it('eases back to 1 at the end edge', () => {
    const atEnd = currentZoom([seg()], 5000)
    expect(atEnd.scale).toBeCloseTo(1, 5)
  })

  it('never overlaps ramps for short segments (ramp capped to half)', () => {
    const s = seg({ startMs: 0, endMs: 200 })
    const z = currentZoom([s], 100)
    expect(z.scale).toBeGreaterThan(1)
    expect(z.scale).toBeLessThanOrEqual(2.2)
  })
})

describe('computeRects', () => {
  const base: LayoutConfig = {
    splitRatio: 0.5,
    swap: false,
    webcamFit: 'cover'
  }

  it('splits 50/50 with screen on top by default', () => {
    const { screen, webcam } = computeRects(1080, 1920, base)
    expect(screen).toEqual({ x: 0, y: 0, w: 1080, h: 960 })
    expect(webcam).toEqual({ x: 0, y: 960, w: 1080, h: 960 })
  })

  it('swaps screen/webcam positions', () => {
    const { screen, webcam } = computeRects(1080, 1920, {
      ...base,
      swap: true
    })
    expect(webcam.y).toBe(0)
    expect(screen.y).toBeGreaterThan(0)
  })

  it('honors a custom split ratio and covers the full frame', () => {
    const { screen, webcam } = computeRects(1080, 1920, {
      ...base,
      splitRatio: 0.65
    })
    expect(screen.h).toBe(Math.round(1920 * 0.65))
    expect(screen.h + webcam.h).toBe(1920)
  })

  it('clamps extreme split ratios', () => {
    const { screen } = computeRects(1080, 1920, {
      ...base,
      splitRatio: 0.99
    })
    expect(screen.h).toBeLessThanOrEqual(Math.round(1920 * 0.85))
  })
})
