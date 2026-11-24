import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_DB_PATH = path.join(ROOT, 'data', 'bookings.db');

/** BOOKINGS_DB_PATH (relative to the cwd) or <project root>/data/bookings.db. */
export function resolveDbPath(env = process.env) {
  const configured = env.BOOKINGS_DB_PATH;
  return configured && configured.trim() ? path.resolve(configured) : DEFAULT_DB_PATH;
}

const SCHEMA = `CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  phone      TEXT    NOT NULL,
  email      TEXT,
  date       TEXT    NOT NULL,
  time       TEXT    NOT NULL,
  party      INTEGER NOT NULL CHECK (party BETWEEN 1 AND 8),
  notes      TEXT
)`;

export function openBookingsDb(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = DELETE');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  const insert = db.prepare(
    'INSERT INTO bookings (created_at, name, phone, email, date, time, party, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  return {
    insertBooking(b, createdAt) {
      const info = insert.run(createdAt, b.name, b.phone, b.email, b.date, b.time, b.party, b.notes);
      return { id: Number(info.lastInsertRowid), created_at: createdAt };
    },
    close() {
      db.close();
    },
  };
}
