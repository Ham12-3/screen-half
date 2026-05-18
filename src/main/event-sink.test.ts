import { describe, expect, it } from 'vitest'
import { readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { EventLog, InputEvent } from '@shared/types'
import { EventSink } from './event-sink'

function tmpPath(): string {
  return join(tmpdir(), `events-${randomUUID()}.json`)
}

describe('EventSink', () => {
  it('writes a valid empty log when nothing was pushed', async () => {
    const p = tmpPath()
    const sink = new EventSink()
    sink.start(p)
    const n = await sink.finalize()
    const log = JSON.parse(readFileSync(p, 'utf8')) as EventLog
    expect(n).toBe(0)
    expect(log).toEqual({ version: 1, events: [] })
    rmSync(p)
  })

  it('streams all events in order and parses back identically', async () => {
    const p = tmpPath()
    const sink = new EventSink()
    sink.start(p)
    const events: InputEvent[] = []
    for (let i = 0; i < 2000; i++) {
      const e: InputEvent =
        i % 5 === 0
          ? { t: i, type: 'down', x: i / 2000, y: 0.5, button: 1 }
          : { t: i, type: 'move', x: i / 2000, y: 0.5 }
      events.push(e)
      sink.push(e)
    }
    const n = await sink.finalize()
    const log = JSON.parse(readFileSync(p, 'utf8')) as EventLog
    expect(n).toBe(2000)
    expect(log.version).toBe(1)
    expect(log.events).toEqual(events)
    rmSync(p)
  })

  it('caps the in-memory buffer so memory stays flat', async () => {
    const p = tmpPath()
    const sink = new EventSink()
    sink.start(p)
    let maxPending = 0
    for (let i = 0; i < 10_000; i++) {
      sink.push({ t: i, type: 'move', x: 0.5, y: 0.5 })
      maxPending = Math.max(maxPending, sink.pending)
    }
    // push() auto-flushes at 480, so the buffer never grows unbounded
    // regardless of how long the recording runs.
    expect(maxPending).toBeLessThanOrEqual(480)
    const n = await sink.finalize()
    expect(n).toBe(10_000)
    rmSync(p)
  })
})
