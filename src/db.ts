/**
 * Workflow Scout — SQLite Database Layer
 *
 * Local-first storage for recorded browser events using better-sqlite3.
 */

import Database from "better-sqlite3";
import path from "path";
import os from "os";
import fs from "fs";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BrowserEvent {
  id?: number;
  timestamp: string;
  type: "navigation" | "click" | "form_submit" | "input_change";
  url: string;
  selector?: string;
  value?: string;
  sessionId: string;
  meta?: string; // JSON-encoded extra metadata
}

export interface Session {
  id: string;
  name: string;
  startedAt: string;
  eventCount: number;
}

// ── Database class ─────────────────────────────────────────────────────────────

const DEFAULT_DB_DIR = path.join(os.homedir(), ".workflow-scout");
const DEFAULT_DB_PATH = path.join(DEFAULT_DB_DIR, "events.db");

export class EventStore {
  private db: Database.Database;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    // Ensure parent directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  // ── Schema ─────────────────────────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp  TEXT    NOT NULL,
        type       TEXT    NOT NULL,
        url        TEXT    NOT NULL,
        selector   TEXT,
        value      TEXT,
        session_id TEXT    NOT NULL,
        meta       TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_type    ON events(type);
      CREATE INDEX IF NOT EXISTS idx_events_ts      ON events(timestamp);
    `);
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  insertEvent(event: BrowserEvent): number {
    const stmt = this.db.prepare(`
      INSERT INTO events (timestamp, type, url, selector, value, session_id, meta)
      VALUES (@timestamp, @type, @url, @selector, @value, @sessionId, @meta)
    `);
    const result = stmt.run({
      timestamp: event.timestamp,
      type: event.type,
      url: event.url,
      selector: event.selector ?? null,
      value: event.value ?? null,
      sessionId: event.sessionId,
      meta: event.meta ?? null,
    });
    return Number(result.lastInsertRowid);
  }

  insertMany(events: BrowserEvent[]): number {
    const insert = this.db.transaction((evts: BrowserEvent[]) => {
      let count = 0;
      for (const evt of evts) {
        this.insertEvent(evt);
        count++;
      }
      return count;
    });
    return insert(events);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  getAllEvents(sessionId?: string): BrowserEvent[] {
    if (sessionId) {
      return this.db
        .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC")
        .all(sessionId) as BrowserEvent[];
    }
    return this.db
      .prepare("SELECT * FROM events ORDER BY timestamp ASC")
      .all() as BrowserEvent[];
  }

  getSessions(): Session[] {
    const rows = this.db
      .prepare(
        `SELECT session_id    AS id,
                session_id    AS name,
                MIN(timestamp) AS startedAt,
                COUNT(*)       AS eventCount
         FROM events
         GROUP BY session_id
         ORDER BY MIN(timestamp) DESC`
      )
      .all() as Session[];
    return rows;
  }

  searchEvents(query: string): BrowserEvent[] {
    const pattern = `%${query}%`;
    return this.db
      .prepare(
        `SELECT * FROM events
         WHERE url LIKE ? OR selector LIKE ? OR value LIKE ? OR meta LIKE ?
         ORDER BY timestamp ASC`
      )
      .all(pattern, pattern, pattern, pattern) as BrowserEvent[];
  }

  getEventCount(sessionId?: string): number {
    if (sessionId) {
      const row = this.db
        .prepare("SELECT COUNT(*) AS cnt FROM events WHERE session_id = ?")
        .get(sessionId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db
      .prepare("SELECT COUNT(*) AS cnt FROM events")
      .get() as { cnt: number };
    return row.cnt;
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  clear(): void {
    this.db.exec("DELETE FROM events");
  }

  close(): void {
    this.db.close();
  }
}
