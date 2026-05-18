import { createWriteStream, type WriteStream } from 'fs'
import type { InputEvent } from '@shared/types'

/**
 * Streams input events to events.json incrementally so the in-memory buffer
 * stays flat over a multi-hour recording instead of growing ~10-15 MB/hour.
 * Produces a valid `{ "version": 1, "events": [...] }` document in a single
 * forward pass — no final reload of the whole log.
 *
 * Kept free of the `electron` import so it is unit-testable under Node.
 */
export class EventSink {
  private buf: InputEvent[] = []
  private stream: WriteStream | null = null
  private wroteAny = false
  private count = 0
  private err: Error | null = null
  private timer: ReturnType<typeof setInterval> | null = null

  /** Buffered (not-yet-flushed) event count — exposed for tests. */
  get pending(): number {
    return this.buf.length
  }

  start(eventsPath: string): void {
    this.buf = []
    this.wroteAny = false
    this.count = 0
    this.err = null
    this.stream = createWriteStream(eventsPath)
    this.stream.on('error', (e) => {
      this.err = e as Error
    })
    this.stream.write('{"version":1,"events":[')
    this.timer = setInterval(() => this.flush(), 2000)
    this.timer.unref()
  }

  push(e: InputEvent): void {
    this.buf.push(e)
    // Hard cap so a burst between timer ticks can't balloon memory.
    if (this.buf.length >= 480) this.flush()
  }

  /** Move the buffered events to disk and drop them from memory. */
  flush(): void {
    if (!this.stream || this.err || this.buf.length === 0) return
    const events = this.buf
    this.buf = []
    const body = events.map((e) => JSON.stringify(e)).join(',')
    this.count += events.length
    this.stream.write((this.wroteAny ? ',' : '') + body)
    this.wroteAny = true
  }

  /** Flush the tail, close the JSON document, return the total count. */
  async finalize(): Promise<number> {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flush()
    const st = this.stream
    this.stream = null
    if (!st) {
      if (this.err) throw this.err
      return this.count
    }
    await new Promise<void>((resolve, reject) => {
      st.on('error', reject)
      st.end(']}', () => resolve())
    })
    if (this.err) throw this.err
    return this.count
  }
}
