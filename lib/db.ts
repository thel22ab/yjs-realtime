import Database from 'better-sqlite3';
import path from 'path';

const db = new Database('risk-assessments.db');
db.pragma('journal_mode = WAL');

// Ensure tables exist
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS document_snapshots (
    document_id TEXT PRIMARY KEY,
    state_vector BLOB,
    updated_at DATETIME
  );
`);

export default db;
