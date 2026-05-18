import { useRef } from 'react'
import type { ZoomSegment } from '@shared/types'
import { ZoomSegmentBlock } from './ZoomSegmentBlock'

interface Props {
  durationMs: number
  trimInMs: number
  trimOutMs: number
  segments: ZoomSegment[]
  playheadMs: number
  selectedId: string | null
  onSeek: (ms: number) => void
  onSelect: (id: string | null) => void
  onChangeSegment: (id: string, patch: Partial<ZoomSegment>) => void
  onTrim: (inMs: number, outMs: number) => void
}

const MIN_SEG_MS = 400

type Drag =
  | { mode: 'seek' }
  | { mode: 'move'; id: string; grab: number }
  | { mode: 'l' | 'r'; id: string }
  | { mode: 'trimIn' }
  | { mode: 'trimOut' }
  | null

export function Timeline({
  durationMs,
  trimInMs,
  trimOutMs,
  segments,
  playheadMs,
  selectedId,
  onSeek,
  onSelect,
  onChangeSegment,
  onTrim
}: Props): JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag>(null)
  const dur = Math.max(1, durationMs)

  const pct = (ms: number): number => (ms / dur) * 100

  const pxToMs = (clientX: number): number => {
    const el = trackRef.current
    if (!el) return 0
    const r = el.getBoundingClientRect()
    const frac = (clientX - r.left) / Math.max(1, r.width)
    return Math.min(dur, Math.max(0, frac * dur))
  }

  const neighbors = (
    id: string
  ): { prevEnd: number; nextStart: number } => {
    const sorted = [...segments].sort((a, b) => a.startMs - b.startMs)
    const i = sorted.findIndex((s) => s.id === id)
    return {
      prevEnd: i > 0 ? sorted[i - 1].endMs : 0,
      nextStart: i < sorted.length - 1 ? sorted[i + 1].startMs : dur
    }
  }

  const beginCapture = (e: React.PointerEvent): void => {
    trackRef.current?.setPointerCapture(e.pointerId)
  }

  const onMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (!d) return
    const ms = pxToMs(e.clientX)
    if (d.mode === 'seek') {
      onSeek(ms)
    } else if (d.mode === 'trimIn') {
      onTrim(Math.min(ms, trimOutMs - 200), trimOutMs)
    } else if (d.mode === 'trimOut') {
      onTrim(trimInMs, Math.max(ms, trimInMs + 200))
    } else {
      const seg = segments.find((s) => s.id === d.id)
      if (!seg) return
      const { prevEnd, nextStart } = neighbors(d.id)
      if (d.mode === 'move') {
        const len = seg.endMs - seg.startMs
        let start = ms - d.grab
        start = Math.max(prevEnd, Math.min(start, nextStart - len))
        onChangeSegment(d.id, { startMs: start, endMs: start + len })
      } else if (d.mode === 'l') {
        const start = Math.max(
          prevEnd,
          Math.min(ms, seg.endMs - MIN_SEG_MS)
        )
        onChangeSegment(d.id, { startMs: start })
      } else {
        const end = Math.min(
          nextStart,
          Math.max(ms, seg.startMs + MIN_SEG_MS)
        )
        onChangeSegment(d.id, { endMs: end })
      }
    }
  }

  const endDrag = (e: React.PointerEvent): void => {
    dragRef.current = null
    try {
      trackRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="timeline">
      <div
        className="timeline__track"
        ref={trackRef}
        onPointerDown={(e) => {
          if (e.target === trackRef.current) {
            dragRef.current = { mode: 'seek' }
            onSelect(null)
            onSeek(pxToMs(e.clientX))
            beginCapture(e)
          }
        }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
      >
        <div
          className="timeline__dim"
          style={{ left: 0, width: `${pct(trimInMs)}%` }}
        />
        <div
          className="timeline__dim"
          style={{
            left: `${pct(trimOutMs)}%`,
            width: `${100 - pct(trimOutMs)}%`
          }}
        />

        {segments.map((s) => (
          <ZoomSegmentBlock
            key={s.id}
            leftPct={pct(s.startMs)}
            widthPct={pct(s.endMs - s.startMs)}
            selected={s.id === selectedId}
            label={`${s.scale.toFixed(1)}×`}
            onBodyDown={(e) => {
              e.stopPropagation()
              onSelect(s.id)
              dragRef.current = {
                mode: 'move',
                id: s.id,
                grab: pxToMs(e.clientX) - s.startMs
              }
              beginCapture(e)
            }}
            onLeftDown={(e) => {
              e.stopPropagation()
              onSelect(s.id)
              dragRef.current = { mode: 'l', id: s.id }
              beginCapture(e)
            }}
            onRightDown={(e) => {
              e.stopPropagation()
              onSelect(s.id)
              dragRef.current = { mode: 'r', id: s.id }
              beginCapture(e)
            }}
          />
        ))}

        <div
          className="timeline__trim timeline__trim--in"
          style={{ left: `${pct(trimInMs)}%` }}
          onPointerDown={(e) => {
            e.stopPropagation()
            dragRef.current = { mode: 'trimIn' }
            beginCapture(e)
          }}
        />
        <div
          className="timeline__trim timeline__trim--out"
          style={{ left: `${pct(trimOutMs)}%` }}
          onPointerDown={(e) => {
            e.stopPropagation()
            dragRef.current = { mode: 'trimOut' }
            beginCapture(e)
          }}
        />

        <div
          className="timeline__playhead"
          style={{ left: `${pct(playheadMs)}%` }}
        />
      </div>
    </div>
  )
}
