import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  DEFAULT_EXPORT,
  DEFAULT_LAYOUT,
  EXPORT_PRESETS,
  type EventLog,
  type ExportSettings,
  type Meta,
  type ProjectFile,
  type ZoomSegment
} from '@shared/types'
import { PreviewCanvas } from '../components/PreviewCanvas'
import { RegionSelector } from '../components/RegionSelector'
import { Timeline } from '../components/Timeline'
import { recordingUrl } from '../render/recordingUrl'
import { generateZoomSegments } from '../render/zoomEngine'
import { exportProject } from '../render/exporter'

interface Props {
  project: ProjectFile | null
  onBack: () => void
}

let segCounter = 1000

/** proj.region (source px) → normalized region for the zoom engine. */
function toNormRegion(
  p: ProjectFile
): { x: number; y: number; w: number; h: number } | undefined {
  if (!p.region) return undefined
  const sw = p.meta.screen.width || 1
  const sh = p.meta.screen.height || 1
  return {
    x: p.region.x / sw,
    y: p.region.y / sh,
    w: p.region.w / sw,
    h: p.region.h / sh
  }
}

export function EditorPage({ project, onBack }: Props): JSX.Element {
  const [proj, setProj] = useState<ProjectFile | null>(project)
  const [sessions, setSessions] = useState<string[]>([])
  const [playing, setPlaying] = useState(false)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [exportState, setExportState] = useState<string | null>(null)
  const [wcSize, setWcSize] = useState({ w: 1280, h: 720 })

  const screenRef = useRef<HTMLVideoElement>(null)
  const webcamRef = useRef<HTMLVideoElement>(null)
  const playheadRef = useRef(0)
  const projRef = useRef<ProjectFile | null>(proj)
  projRef.current = proj

  const getTimeMs = useCallback(() => playheadRef.current, [])

  // Session picker when opened without a fresh recording.
  useEffect(() => {
    if (!proj) window.api.listSessions().then(setSessions)
  }, [proj])

  const openSession = useCallback(async (sessionId: string) => {
    const paths = await window.api.getSessionPaths(sessionId)
    let loaded: ProjectFile
    try {
      loaded = await window.api.readJson<ProjectFile>(paths.projectPath)
    } catch {
      const meta = await window.api.readJson<Meta>(paths.metaPath)
      loaded = {
        version: 1,
        sessionId,
        meta,
        trimInMs: 0,
        trimOutMs: meta.durationMs,
        layout: { ...DEFAULT_LAYOUT },
        zoomSegments: []
      }
    }
    setProj(loaded)
  }, [])

  // Auto-generate zoom moments from the input log if none exist yet.
  useEffect(() => {
    if (!proj || proj.zoomSegments.length > 0) return
    let cancelled = false
    ;(async () => {
      const paths = await window.api.getSessionPaths(proj.sessionId)
      try {
        const log = await window.api.readJson<EventLog>(paths.eventsPath)
        const segs = generateZoomSegments(
          log,
          proj.meta.durationMs,
          {},
          toNormRegion(proj)
        )
        if (!cancelled && segs.length > 0) {
          setProj((p) => (p ? { ...p, zoomSegments: segs } : p))
        }
      } catch {
        /* no events — leave empty, user can add manually */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [proj?.sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced persistence of edits.
  useEffect(() => {
    if (!proj) return
    const t = setTimeout(() => {
      window.api
        .getSessionPaths(proj.sessionId)
        .then((p) => window.api.writeJson(p.projectPath, proj))
        .catch(() => undefined)
    }, 500)
    return () => clearTimeout(t)
  }, [proj])

  // Master playback loop: screen video drives the clock.
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      const sv = screenRef.current
      const wv = webcamRef.current
      const p = projRef.current
      if (sv && p) {
        const tMs = sv.currentTime * 1000
        if (playing && tMs >= p.trimOutMs) {
          sv.pause()
          wv?.pause()
          sv.currentTime = p.trimInMs / 1000
          playheadRef.current = p.trimInMs
          setPlayheadMs(p.trimInMs)
          setPlaying(false)
        } else {
          playheadRef.current = tMs
          if (playing) setPlayheadMs(tMs)
          if (
            wv &&
            Math.abs(wv.currentTime - sv.currentTime) > 0.18
          ) {
            wv.currentTime = sv.currentTime
          }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const seek = useCallback((ms: number) => {
    playheadRef.current = ms
    setPlayheadMs(ms)
    if (screenRef.current) screenRef.current.currentTime = ms / 1000
    if (webcamRef.current) webcamRef.current.currentTime = ms / 1000
  }, [])

  const togglePlay = useCallback(() => {
    const sv = screenRef.current
    const wv = webcamRef.current
    if (!sv || !proj) return
    if (playing) {
      sv.pause()
      wv?.pause()
      setPlaying(false)
    } else {
      if (sv.currentTime * 1000 >= proj.trimOutMs - 50) {
        seek(proj.trimInMs)
      }
      void sv.play()
      void wv?.play()
      setPlaying(true)
    }
  }, [playing, proj, seek])

  const patchSeg = useCallback(
    (id: string, patch: Partial<ZoomSegment>) => {
      setProj((p) =>
        p
          ? {
              ...p,
              zoomSegments: p.zoomSegments.map((s) =>
                s.id === id ? { ...s, ...patch } : s
              )
            }
          : p
      )
    },
    []
  )

  const addSegAtPlayhead = useCallback(() => {
    setProj((p) => {
      if (!p) return p
      const start = playheadRef.current
      const end = Math.min(p.meta.durationMs, start + 2200)
      const seg: ZoomSegment = {
        id: `m${segCounter++}`,
        startMs: start,
        endMs: end,
        scale: 2.2,
        focusX: 0.5,
        focusY: 0.5,
        easing: 'easeInOut'
      }
      const zoomSegments = [...p.zoomSegments, seg].sort(
        (a, b) => a.startMs - b.startMs
      )
      return { ...p, zoomSegments }
    })
  }, [])

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setProj((p) =>
      p
        ? {
            ...p,
            zoomSegments: p.zoomSegments.filter(
              (s) => s.id !== selectedId
            )
          }
        : p
    )
    setSelectedId(null)
  }, [selectedId])

  const regenerate = useCallback(async () => {
    if (!proj) return
    const paths = await window.api.getSessionPaths(proj.sessionId)
    try {
      const log = await window.api.readJson<EventLog>(paths.eventsPath)
      const segs = generateZoomSegments(
        log,
        proj.meta.durationMs,
        {},
        toNormRegion(proj)
      )
      setProj((p) => (p ? { ...p, zoomSegments: segs } : p))
    } catch {
      setExportState('No input log to regenerate from.')
    }
  }, [proj])

  const setLayout = useCallback(
    (patch: Partial<ProjectFile['layout']>) => {
      setProj((p) =>
        p ? { ...p, layout: { ...p.layout, ...patch } } : p
      )
    },
    []
  )

  const setExport = useCallback((patch: Partial<ExportSettings>) => {
    setProj((p) =>
      p
        ? {
            ...p,
            exportSettings: {
              ...(p.exportSettings ?? DEFAULT_EXPORT),
              ...patch
            }
          }
        : p
    )
  }, [])

  const doExport = useCallback(async () => {
    if (!proj || !screenRef.current || !webcamRef.current) return
    setExportState('Exporting… 0%')
    try {
      const out = await exportProject({
        project: proj,
        screenVideo: screenRef.current,
        webcamVideo: webcamRef.current,
        screenSize: {
          w: proj.meta.screen.width,
          h: proj.meta.screen.height
        },
        webcamSize: wcSize,
        onProgress: (f) =>
          setExportState(`Exporting… ${Math.round(f * 100)}%`)
      })
      setExportState(`Saved: ${out}`)
    } catch (e) {
      setExportState(`Export failed: ${String(e)}`)
    }
  }, [proj, wcSize])

  const selected = useMemo(
    () => proj?.zoomSegments.find((s) => s.id === selectedId) ?? null,
    [proj, selectedId]
  )

  if (!proj) {
    return (
      <div className="page">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Open a recording</h2>
          {sessions.length === 0 && (
            <p className="muted">
              No recordings yet. Go back and record one.
            </p>
          )}
          {sessions.map((s) => (
            <div key={s} style={{ marginBottom: 8 }}>
              <button onClick={() => openSession(s)}>{s}</button>
            </div>
          ))}
          <button onClick={onBack} style={{ marginTop: 12 }}>
            ← Back
          </button>
        </div>
      </div>
    )
  }

  const fmt = (ms: number): string => {
    const s = Math.max(0, ms / 1000)
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(
      2,
      '0'
    )}`
  }

  return (
    <div className="editor">
      <video
        ref={screenRef}
        src={recordingUrl(proj.sessionId, 'screen.webm')}
        crossOrigin="anonymous"
        muted
        playsInline
        preload="auto"
        style={{ display: 'none' }}
      />
      <video
        ref={webcamRef}
        src={recordingUrl(proj.sessionId, 'webcam.webm')}
        crossOrigin="anonymous"
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={(e) => {
          const v = e.currentTarget
          if (v.videoWidth)
            setWcSize({ w: v.videoWidth, h: v.videoHeight })
        }}
        style={{ display: 'none' }}
      />

      <div className="editor__stage">
        <PreviewCanvas
          screenRef={screenRef}
          webcamRef={webcamRef}
          screenSize={{
            w: proj.meta.screen.width,
            h: proj.meta.screen.height
          }}
          webcamSize={wcSize}
          layout={proj.layout}
          segments={proj.zoomSegments}
          region={proj.region}
          getTimeMs={getTimeMs}
        />
      </div>

      <div className="editor__side">
        <div className="card">
          <div className="row" style={{ alignItems: 'center' }}>
            <button className="primary" onClick={togglePlay}>
              {playing ? '❚❚ Pause' : '▶ Play'}
            </button>
            <span className="muted">
              {fmt(playheadMs)} / {fmt(proj.meta.durationMs)}
            </span>
            <button onClick={onBack}>← Back</button>
          </div>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Layout</h3>
          <div className="field">
            <label>Screen / webcam split ({Math.round(
              proj.layout.splitRatio * 100
            )}% screen)</label>
            <input
              type="range"
              min={0.2}
              max={0.8}
              step={0.01}
              value={proj.layout.splitRatio}
              onChange={(e) =>
                setLayout({ splitRatio: Number(e.target.value) })
              }
            />
          </div>
          <label className="muted" style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={proj.layout.swap}
              onChange={(e) => setLayout({ swap: e.target.checked })}
            />{' '}
            Webcam on top
          </label>
          <div className="field" style={{ marginTop: 12 }}>
            <label>Webcam fit</label>
            <select
              value={proj.layout.webcamFit}
              onChange={(e) =>
                setLayout({
                  webcamFit: e.target.value as 'cover' | 'contain'
                })
              }
            >
              <option value="cover">Cover (fill)</option>
              <option value="contain">Contain (fit)</option>
            </select>
          </div>
        </div>

        {proj.meta.sourceKind === 'screen' && (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Screen region</h3>
            <RegionSelector
              sessionId={proj.sessionId}
              screenW={proj.meta.screen.width}
              screenH={proj.meta.screen.height}
              region={proj.region}
              onChange={(region) =>
                setProj((p) => (p ? { ...p, region } : p))
              }
            />
            <p className="hint">
              After changing the region, hit ↻ Regenerate below so
              auto-zoom re-targets inside it.
            </p>
          </div>
        )}

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Auto-zoom</h3>
          <div className="row">
            <button onClick={addSegAtPlayhead}>+ Zoom at playhead</button>
            <button onClick={regenerate}>↻ Regenerate</button>
          </div>
          {selected ? (
            <div style={{ marginTop: 12 }}>
              <div className="field">
                <label>
                  Zoom level ({selected.scale.toFixed(2)}×)
                </label>
                <input
                  type="range"
                  min={1.1}
                  max={3.5}
                  step={0.05}
                  value={selected.scale}
                  onChange={(e) =>
                    patchSeg(selected.id, {
                      scale: Number(e.target.value)
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Focus X ({selected.focusX.toFixed(2)})</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selected.focusX}
                  onChange={(e) =>
                    patchSeg(selected.id, {
                      focusX: Number(e.target.value)
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Focus Y ({selected.focusY.toFixed(2)})</label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={selected.focusY}
                  onChange={(e) =>
                    patchSeg(selected.id, {
                      focusY: Number(e.target.value)
                    })
                  }
                />
              </div>
              <button className="danger" onClick={deleteSelected}>
                Delete zoom
              </button>
            </div>
          ) : (
            <p className="hint">
              Select a block on the timeline to tune it.
            </p>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Export</h3>
          {(() => {
            const es = proj.exportSettings ?? DEFAULT_EXPORT
            return (
              <>
                <div className="field">
                  <label>Resolution</label>
                  <select
                    value={es.width}
                    onChange={(e) => {
                      const p = EXPORT_PRESETS.find(
                        (x) => x.width === Number(e.target.value)
                      )
                      if (p) setExport({ width: p.width, height: p.height })
                    }}
                  >
                    {EXPORT_PRESETS.map((p) => (
                      <option key={p.width} value={p.width}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Frame rate</label>
                  <select
                    value={es.fps}
                    onChange={(e) =>
                      setExport({ fps: Number(e.target.value) })
                    }
                  >
                    <option value={30}>30 fps</option>
                    <option value={60}>60 fps</option>
                  </select>
                </div>
                <button className="primary" onClick={doExport}>
                  ⤓ Export {es.width}×{es.height} MP4
                </button>
              </>
            )
          })()}
          {exportState && <p className="hint">{exportState}</p>}
        </div>
      </div>

      <div className="editor__timeline">
        <Timeline
          durationMs={proj.meta.durationMs}
          trimInMs={proj.trimInMs}
          trimOutMs={proj.trimOutMs}
          segments={proj.zoomSegments}
          playheadMs={playheadMs}
          selectedId={selectedId}
          onSeek={seek}
          onSelect={setSelectedId}
          onChangeSegment={patchSeg}
          onTrim={(inMs, outMs) =>
            setProj((p) =>
              p ? { ...p, trimInMs: inMs, trimOutMs: outMs } : p
            )
          }
        />
      </div>
    </div>
  )
}
