import { useRef } from 'react'
import type { CropRegion } from '@shared/types'
import { recordingUrl } from '../render/recordingUrl'

interface Props {
  sessionId: string
  screenW: number
  screenH: number
  region?: CropRegion
  onChange: (region: CropRegion | undefined) => void
}

type Drag =
  | { mode: 'new'; ax: number; ay: number }
  | { mode: 'move'; gx: number; gy: number }
  | { mode: 'resize' }
  | null

const MIN_FRAC = 0.06

/**
 * Pick a sub-rectangle of the captured screen. Shows a still from the
 * recording as reference; drag on empty space to draw a region, drag the
 * box to move it, drag the corner to resize. Region is stored in source
 * pixels so it's resolution-independent.
 */
export function RegionSelector({
  sessionId,
  screenW,
  screenH,
  region,
  onChange
}: Props): JSX.Element {
  const boxRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)

  const aspect = screenW > 0 && screenH > 0 ? screenW / screenH : 16 / 9

  // Normalized (0..1) region currently shown.
  const norm = region
    ? {
        x: region.x / screenW,
        y: region.y / screenH,
        w: region.w / screenW,
        h: region.h / screenH
      }
    : { x: 0, y: 0, w: 1, h: 1 }

  const ptr = (e: React.PointerEvent): { x: number; y: number } => {
    const el = boxRef.current
    if (!el) return { x: 0, y: 0 }
    const r = el.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))
    }
  }

  const commit = (n: {
    x: number
    y: number
    w: number
    h: number
  }): void => {
    const x = Math.min(Math.max(0, n.x), 1 - MIN_FRAC)
    const y = Math.min(Math.max(0, n.y), 1 - MIN_FRAC)
    const w = Math.min(Math.max(MIN_FRAC, n.w), 1 - x)
    const h = Math.min(Math.max(MIN_FRAC, n.h), 1 - y)
    if (x <= 0 && y <= 0 && w >= 1 && h >= 1) {
      onChange(undefined)
      return
    }
    onChange({
      x: Math.round(x * screenW),
      y: Math.round(y * screenH),
      w: Math.round(w * screenW),
      h: Math.round(h * screenH)
    })
  }

  const onMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const p = ptr(e)
    if (d.mode === 'new') {
      commit({
        x: Math.min(d.ax, p.x),
        y: Math.min(d.ay, p.y),
        w: Math.abs(p.x - d.ax),
        h: Math.abs(p.y - d.ay)
      })
    } else if (d.mode === 'move') {
      commit({
        x: p.x - d.gx,
        y: p.y - d.gy,
        w: norm.w,
        h: norm.h
      })
    } else {
      commit({
        x: norm.x,
        y: norm.y,
        w: p.x - norm.x,
        h: p.y - norm.y
      })
    }
  }

  return (
    <div>
      <div
        ref={boxRef}
        className="region"
        style={{ aspectRatio: String(aspect) }}
        onPointerDown={(e) => {
          if (e.target !== boxRef.current) return
          const p = ptr(e)
          dragRef.current = { mode: 'new', ax: p.x, ay: p.y }
          boxRef.current?.setPointerCapture(e.pointerId)
        }}
        onPointerMove={onMove}
        onPointerUp={(e) => {
          dragRef.current = null
          try {
            boxRef.current?.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
      >
        <video
          src={recordingUrl(sessionId, 'screen.webm')}
          crossOrigin="anonymous"
          muted
          preload="auto"
          onLoadedMetadata={(e) => {
            e.currentTarget.currentTime = Math.min(
              1,
              e.currentTarget.duration / 2 || 0.5
            )
          }}
          className="region__ref"
        />
        <div
          className="region__rect"
          style={{
            left: `${norm.x * 100}%`,
            top: `${norm.y * 100}%`,
            width: `${norm.w * 100}%`,
            height: `${norm.h * 100}%`
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            const p = ptr(e)
            dragRef.current = {
              mode: 'move',
              gx: p.x - norm.x,
              gy: p.y - norm.y
            }
            boxRef.current?.setPointerCapture(e.pointerId)
          }}
        >
          <div
            className="region__handle"
            onPointerDown={(e) => {
              e.stopPropagation()
              dragRef.current = { mode: 'resize' }
              boxRef.current?.setPointerCapture(e.pointerId)
            }}
          />
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => onChange(undefined)}>
          Clear region (full screen)
        </button>
      </div>
      <p className="hint">
        {region
          ? `Region ${region.w}×${region.h} of ${screenW}×${screenH}`
          : 'Using the whole screen. Drag to crop to a region.'}
      </p>
    </div>
  )
}
