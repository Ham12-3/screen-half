import { useEffect, useRef } from 'react'
import {
  OUTPUT_HEIGHT,
  OUTPUT_WIDTH,
  type CropRegion,
  type LayoutConfig,
  type ZoomSegment
} from '@shared/types'
import { drawComposite } from '../render/composite'

interface Props {
  screenRef: React.RefObject<HTMLVideoElement>
  webcamRef: React.RefObject<HTMLVideoElement>
  screenSize: { w: number; h: number }
  webcamSize: { w: number; h: number }
  layout: LayoutConfig
  segments: ZoomSegment[]
  region?: CropRegion
  /** Current playhead in ms relative to the recording start. */
  getTimeMs: () => number
}

export function PreviewCanvas({
  screenRef,
  webcamRef,
  screenSize,
  webcamSize,
  layout,
  segments,
  region,
  getTimeMs
}: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stateRef = useRef({
    layout,
    segments,
    screenSize,
    webcamSize,
    region
  })
  stateRef.current = { layout, segments, screenSize, webcamSize, region }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let raf = 0

    const ready = (v: HTMLVideoElement | null): v is HTMLVideoElement =>
      !!v && v.readyState >= 2

    const status = (v: HTMLVideoElement | null): string => {
      if (!v) return 'no element'
      if (v.error) return `error code ${v.error.code}`
      return `loading… (readyState ${v.readyState})`
    }

    const loop = (): void => {
      const s = stateRef.current
      const sv = screenRef.current
      const wv = webcamRef.current
      drawComposite(ctx, {
        screen: ready(sv)
          ? {
              img: sv,
              w: s.screenSize.w,
              h: s.screenSize.h,
              region: s.region
            }
          : null,
        webcam: ready(wv)
          ? { img: wv, w: s.webcamSize.w, h: s.webcamSize.h }
          : null,
        layout: s.layout,
        segments: s.segments,
        tMs: getTimeMs(),
        outW: OUTPUT_WIDTH,
        outH: OUTPUT_HEIGHT
      })

      // Surface why a half is black instead of failing silently.
      ctx.font = '34px sans-serif'
      ctx.fillStyle = '#ff9bb0'
      ctx.textAlign = 'center'
      if (!ready(sv)) {
        ctx.fillText(
          `Screen: ${status(sv)}`,
          OUTPUT_WIDTH / 2,
          OUTPUT_HEIGHT * 0.25
        )
      }
      if (!ready(wv)) {
        ctx.fillText(
          `Webcam: ${status(wv)}`,
          OUTPUT_WIDTH / 2,
          OUTPUT_HEIGHT * 0.75
        )
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [screenRef, webcamRef, getTimeMs])

  return (
    <canvas
      ref={canvasRef}
      width={OUTPUT_WIDTH}
      height={OUTPUT_HEIGHT}
      className="preview-frame"
      style={{ height: '100%', width: 'auto', display: 'block' }}
    />
  )
}
