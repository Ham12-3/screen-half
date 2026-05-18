import type { CropRegion, LayoutConfig, ZoomSegment } from '@shared/types'
import { clamp, ease, lerp } from './easing'
import { ZOOM_RAMP_MS } from './zoomEngine'

/**
 * The ONE compositor used by both the live editor preview and the offline
 * export render, so what you preview is exactly what you get.
 *
 * Output is a vertical 9:16 frame split into two stacked halves (screen +
 * webcam) per LayoutConfig. The screen half continuously eases from
 * "whole desktop, contained on a blurred backdrop" (scale 1) up to a
 * focused crop (scale > 1) driven by the auto-zoom segments.
 */

export interface ZoomState {
  scale: number
  fx: number
  fy: number
}

/** Pure: resolve the zoom (scale + focus) at time t from the segment list. */
export function currentZoom(
  segments: ZoomSegment[],
  tMs: number
): ZoomState {
  for (const s of segments) {
    if (tMs < s.startMs || tMs > s.endMs) continue
    const ramp = Math.min(ZOOM_RAMP_MS, (s.endMs - s.startMs) / 2)
    let scale = s.scale
    if (tMs < s.startMs + ramp) {
      const p = ramp > 0 ? (tMs - s.startMs) / ramp : 1
      scale = lerp(1, s.scale, ease(s.easing, p))
    } else if (tMs > s.endMs - ramp) {
      const p = ramp > 0 ? (s.endMs - tMs) / ramp : 1
      scale = lerp(1, s.scale, ease(s.easing, p))
    }
    return { scale, fx: s.focusX, fy: s.focusY }
  }
  return { scale: 1, fx: 0.5, fy: 0.5 }
}

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** Split the output frame into screen + webcam rectangles per layout. */
export function computeRects(
  outW: number,
  outH: number,
  layout: LayoutConfig
): { screen: Rect; webcam: Rect } {
  const topH = Math.round(outH * clamp(layout.splitRatio, 0.15, 0.85))
  const top: Rect = { x: 0, y: 0, w: outW, h: topH }
  const bottom: Rect = { x: 0, y: topH, w: outW, h: outH - topH }
  return layout.swap
    ? { webcam: top, screen: bottom }
    : { screen: top, webcam: bottom }
}

type Img = CanvasImageSource & { width?: number; height?: number }

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: Img,
  sw: number,
  sh: number,
  d: Rect
): void {
  const scale = Math.max(d.w / sw, d.h / sh)
  const w = sw * scale
  const h = sh * scale
  ctx.drawImage(img, d.x + (d.w - w) / 2, d.y + (d.h - h) / 2, w, h)
}

/**
 * Draw the screen into its half with the active-region zoom applied.
 * The screen fills its half (cover fit) — no letterboxing, no blurred
 * side bars. `region` (source pixels) crops the screen image before
 * fit/zoom, so a chosen sub-region fills the half at higher effective
 * resolution.
 */
function drawScreen(
  ctx: CanvasRenderingContext2D,
  img: Img,
  sw: number,
  sh: number,
  d: Rect,
  zoom: ZoomState,
  region?: CropRegion
): void {
  const rx = region ? clamp(region.x, 0, sw) : 0
  const ry = region ? clamp(region.y, 0, sh) : 0
  const rw = region ? clamp(region.w, 1, sw - rx) : sw
  const rh = region ? clamp(region.h, 1, sh - ry) : sh

  ctx.save()
  ctx.beginPath()
  ctx.rect(d.x, d.y, d.w, d.h)
  ctx.clip()

  // Cover fit of the region (fills the half, crops overflow), then scaled
  // by the current zoom and panned so the focus point trends to the
  // half's center.
  const k = Math.max(d.w / rw, d.h / rh)
  const drawnW = rw * k * zoom.scale
  const drawnH = rh * k * zoom.scale
  const cx = d.x + d.w / 2
  const cy = d.y + d.h / 2

  let dx = cx - zoom.fx * drawnW
  let dy = cy - zoom.fy * drawnH
  if (drawnW >= d.w) dx = clamp(dx, d.x + d.w - drawnW, d.x)
  else dx = d.x + (d.w - drawnW) / 2
  if (drawnH >= d.h) dy = clamp(dy, d.y + d.h - drawnH, d.y)
  else dy = d.y + (d.h - drawnH) / 2

  ctx.drawImage(img, rx, ry, rw, rh, dx, dy, drawnW, drawnH)
  ctx.restore()
}

function drawWebcam(
  ctx: CanvasRenderingContext2D,
  img: Img,
  sw: number,
  sh: number,
  d: Rect,
  fit: LayoutConfig['webcamFit']
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(d.x, d.y, d.w, d.h)
  ctx.clip()
  ctx.fillStyle = '#000'
  ctx.fillRect(d.x, d.y, d.w, d.h)
  if (fit === 'cover') {
    drawCover(ctx, img, sw, sh, d)
  } else {
    const scale = Math.min(d.w / sw, d.h / sh)
    const w = sw * scale
    const h = sh * scale
    ctx.drawImage(img, d.x + (d.w - w) / 2, d.y + (d.h - h) / 2, w, h)
  }
  ctx.restore()
}

export interface CompositeOpts {
  screen: { img: Img; w: number; h: number; region?: CropRegion } | null
  webcam: { img: Img; w: number; h: number } | null
  layout: LayoutConfig
  segments: ZoomSegment[]
  tMs: number
  outW: number
  outH: number
}

export function drawComposite(
  ctx: CanvasRenderingContext2D,
  o: CompositeOpts
): void {
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, o.outW, o.outH)

  const { screen, webcam } = computeRects(o.outW, o.outH, o.layout)

  if (o.screen) {
    const zoom = currentZoom(o.segments, o.tMs)
    drawScreen(
      ctx,
      o.screen.img,
      o.screen.w,
      o.screen.h,
      screen,
      zoom,
      o.screen.region
    )
  }
  if (o.webcam) {
    drawWebcam(
      ctx,
      o.webcam.img,
      o.webcam.w,
      o.webcam.h,
      webcam,
      o.layout.webcamFit
    )
  }
}
