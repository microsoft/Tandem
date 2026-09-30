import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { CanvasEvent, NewCanvasEvent } from './canvas-event.ts';

export type CanvasEventListener = (event: CanvasEvent) => void;

export class InMemoryEventStore {
  readonly streamId: string = randomUUID();
  readonly #events: CanvasEvent[] = [];
  protected readonly listeners = new Set<CanvasEventListener>();

  append(input: NewCanvasEvent): CanvasEvent {
    const event: CanvasEvent = {
      ...input,
      sequence: this.#events.length + 1,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    this.#events.push(event);
    this.publish(event);
    return event;
  }

  list(afterSequence = 0): CanvasEvent[] {
    return this.#events.filter((event) => event.sequence > afterSequence);
  }

  listRecent(limit: number): CanvasEvent[] {
    validateEventLimit(limit);
    return this.#events.slice(-limit);
  }

  listBefore(beforeSequence: number, limit: number): CanvasEvent[] {
    validateEventLimit(limit);
    return this.#events.filter((event) => event.sequence < beforeSequence).slice(-limit);
  }

  subscribe(listener: CanvasEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  protected publish(event: CanvasEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

interface EventStateRow {
  stream_id: string;
  last_sequence: number;
}

interface PersistedEventRow {
  sequence: number;
  timestamp: string;
  type: string;
  source: CanvasEvent['source'];
  summary: string;
  data_json: string | null;
}

export class SqliteEventStore extends InMemoryEventStore {
  override readonly streamId: string;
  readonly #database: DatabaseSync;
  readonly #maximumEvents: number | null;
  #lastSequence: number;
  #persistedSincePrune = 0;
  #volatileEvents: CanvasEvent[] = [];
  #reportedPersistenceFailure = false;

  constructor(workspace: string, maximumEvents: number | null = 10_000) {
    super();
    if (maximumEvents !== null && (!Number.isInteger(maximumEvents) || maximumEvents < 1)) {
      throw new Error('Event history retention must be a positive integer or null for append-only history.');
    }
    const path = resolve(
      workspace,
      '.tandem',
      'living-canvas',
      'events.sqlite',
    );
    mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path);
    this.#maximumEvents = maximumEvents;
    this.#database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS event_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        stream_id TEXT NOT NULL,
        last_sequence INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS canvas_events (
        sequence INTEGER PRIMARY KEY,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        summary TEXT NOT NULL,
        data_json TEXT
      ) STRICT;
      CREATE TABLE IF NOT EXISTS seen_session_events (
        session_event_id TEXT PRIMARY KEY
      ) STRICT;
    `);
    this.#database.prepare(`
      INSERT OR IGNORE INTO event_state (id, stream_id, last_sequence)
      VALUES (1, ?, 0)
    `).run(randomUUID());
    const state = this.#database.prepare(`
      SELECT stream_id, last_sequence FROM event_state WHERE id = 1
    `).get() as unknown as EventStateRow | undefined;
    if (!state) {
      throw new Error('SQLite event history state could not be initialized.');
    }
    this.streamId = state.stream_id;
    this.#lastSequence = state.last_sequence;
  }

  override append(input: NewCanvasEvent): CanvasEvent {
    const event: CanvasEvent = {
      ...input,
      sequence: this.#lastSequence + 1,
      timestamp: input.timestamp ?? new Date().toISOString(),
    };
    this.#lastSequence = event.sequence;
    try {
      this.#database.exec('BEGIN IMMEDIATE');
      this.#database.prepare(`
        UPDATE event_state SET last_sequence = ? WHERE id = 1
      `).run(event.sequence);
      if (event.type !== 'assistant.message_delta') {
        this.#database.prepare(`
          INSERT INTO canvas_events (
            sequence, timestamp, type, source, summary, data_json
          ) VALUES (?, ?, ?, ?, ?, ?)
        `).run(
          event.sequence,
          event.timestamp,
          event.type,
          event.source,
          event.summary,
          event.data === undefined ? null : JSON.stringify(event.data),
        );
        if (this.#maximumEvents !== null) {
          this.#persistedSincePrune += 1;
        }
        if (this.#maximumEvents !== null && this.#persistedSincePrune >= 100) {
          this.#database.prepare(`
            DELETE FROM canvas_events
            WHERE sequence NOT IN (
              SELECT sequence FROM canvas_events
              ORDER BY sequence DESC
              LIMIT ?
            )
          `).run(this.#maximumEvents);
          this.#persistedSincePrune = 0;
        }
      }
      const sessionEventId = sessionEventIdFrom(event.data);
      if (sessionEventId) {
        this.#database.prepare(`
          INSERT OR IGNORE INTO seen_session_events (session_event_id)
          VALUES (?)
        `).run(sessionEventId);
      }
      this.#database.exec('COMMIT');
    } catch (error) {
      try {
        this.#database.exec('ROLLBACK');
      } catch {
        // The original persistence error is the actionable failure.
      }
      this.#volatileEvents.push(event);
      this.#reportPersistenceFailure(error);
    }
    this.publish(event);
    return event;
  }

  override list(afterSequence = 0): CanvasEvent[] {
    return this.#readEvents(afterSequence);
  }

  override listRecent(limit: number): CanvasEvent[] {
    validateEventLimit(limit);
    return this.#readEvents(0, limit);
  }

  override listBefore(beforeSequence: number, limit: number): CanvasEvent[] {
    validateEventLimit(limit);
    return this.#readEvents(0, limit, beforeSequence);
  }

  #readEvents(afterSequence: number, limit?: number, beforeSequence = Number.MAX_SAFE_INTEGER): CanvasEvent[] {
    let persisted: CanvasEvent[] = [];
    try {
      const query = this.#database.prepare(`
        SELECT sequence, timestamp, type, source, summary, data_json
        FROM canvas_events
        WHERE sequence > ? AND sequence < ?
        ORDER BY sequence ${limit === undefined ? 'ASC' : 'DESC LIMIT ?'}
      `);
      const rows = (limit === undefined
        ? query.all(afterSequence, beforeSequence)
        : query.all(afterSequence, beforeSequence, limit)) as unknown as PersistedEventRow[];
      persisted = rows.map((row) => ({
        sequence: row.sequence,
        timestamp: row.timestamp,
        type: row.type,
        source: row.source,
        summary: row.summary,
        ...(row.data_json === null
          ? {}
          : { data: JSON.parse(row.data_json) as unknown }),
      }));
    } catch (error) {
      this.#reportPersistenceFailure(error);
    }
    const events = [
      ...persisted,
      ...this.#volatileEvents.filter((event) => event.sequence > afterSequence && event.sequence < beforeSequence),
    ].sort((left, right) => left.sequence - right.sequence);
    return limit === undefined ? events : events.slice(-limit);
  }

  close(): void {
    this.#database.close();
  }

  hasSessionEventId(sessionEventId: string): boolean {
    return this.#database.prepare(`
      SELECT 1 FROM seen_session_events WHERE session_event_id = ?
    `).get(sessionEventId) !== undefined;
  }

  rememberSessionEventId(sessionEventId: string): void {
    try {
      this.#database.prepare(`
        INSERT OR IGNORE INTO seen_session_events (session_event_id)
        VALUES (?)
      `).run(sessionEventId);
    } catch (error) {
      this.#reportPersistenceFailure(error);
    }
  }

  #reportPersistenceFailure(error: unknown): void {
    if (this.#reportedPersistenceFailure) {
      return;
    }

    this.#reportedPersistenceFailure = true;
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `Activity history persistence failed; continuing with volatile history: ${message}\n`,
    );
  }
}

function validateEventLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Event query limit must be a positive integer.');
  }
}

function sessionEventIdFrom(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const sessionEventId = (value as Record<string, unknown>).sessionEventId;
  return typeof sessionEventId === 'string' ? sessionEventId : undefined;
}
