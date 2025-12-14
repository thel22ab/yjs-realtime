// persistence.js
// Handles SQLite persistence for Yjs documents

const Database = require("better-sqlite3");
const Y = require("yjs");

// ---- SQLite Setup ----
const db = new Database("risk-assessments.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS document_snapshots (
    document_id TEXT PRIMARY KEY,
    snapshot_update BLOB NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS document_updates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT NOT NULL,
    update BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_document_updates_doc_id_id
    ON document_updates(document_id, id);
`);

// ---- Prepared Statements ----
const stmtUpsertSnapshot = db.prepare(`
  INSERT INTO document_snapshots (document_id, snapshot_update, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(document_id) DO UPDATE SET
    snapshot_update = excluded.snapshot_update,
    updated_at = excluded.updated_at
`);

const stmtGetSnapshot = db.prepare(`
  SELECT snapshot_update FROM document_snapshots WHERE document_id = ?
`);

const stmtInsertUpdate = db.prepare(`
  INSERT INTO document_updates (document_id, update, created_at)
  VALUES (?, ?, ?)
`);

const stmtGetUpdates = db.prepare(`
  SELECT id, update FROM document_updates
  WHERE document_id = ?
  ORDER BY id ASC
`);

const stmtDeleteUpdates = db.prepare(`
  DELETE FROM document_updates WHERE document_id = ?
`);

const txSaveSnapshotAndClearUpdates = db.transaction((docId, snapshotBuf) => {
    stmtUpsertSnapshot.run(docId, snapshotBuf, Date.now());
    stmtDeleteUpdates.run(docId);
});

// ---- Tuning Constants ----
const DEBOUNCE_MS = 500;
const COMPACTION_INTERVAL_MS = 60_000;
const COMPACT_EVERY_N_UPDATE_ROWS = 200;

// ---- In-memory Document Metadata ----
const docMeta = new Map();

function getOrCreateMeta(docId) {
    let meta = docMeta.get(docId);
    if (!meta) {
        meta = {
            pending: [],
            flushTimer: null,
            compactTimer: null,
            updateRowsSinceCompact: 0,
        };
        docMeta.set(docId, meta);
    }
    return meta;
}

// ---- Persistence Functions ----

function flushPendingUpdates(docId) {
    const meta = docMeta.get(docId);
    if (!meta || meta.pending.length === 0) return;

    const merged = Y.mergeUpdates(meta.pending);
    meta.pending = [];

    stmtInsertUpdate.run(docId, Buffer.from(merged), Date.now());
    meta.updateRowsSinceCompact += 1;
}

function scheduleFlush(docId) {
    const meta = getOrCreateMeta(docId);

    if (meta.flushTimer) clearTimeout(meta.flushTimer);
    meta.flushTimer = setTimeout(() => {
        meta.flushTimer = null;
        flushPendingUpdates(docId);
    }, DEBOUNCE_MS);
}

function startCompactionTimer(docId, doc) {
    const meta = getOrCreateMeta(docId);
    if (meta.compactTimer) return;

    meta.compactTimer = setInterval(() => {
        compactDoc(docId, doc);
    }, COMPACTION_INTERVAL_MS);
}

function compactDoc(docId, doc) {
    const meta = docMeta.get(docId);

    flushPendingUpdates(docId);

    if (meta && meta.updateRowsSinceCompact === 0) return;

    const snapshot = Y.encodeStateAsUpdate(doc);
    txSaveSnapshotAndClearUpdates(docId, Buffer.from(snapshot));

    if (meta) meta.updateRowsSinceCompact = 0;

    console.log(
        `[Compaction] Snapshot saved for ${docId} (${snapshot.byteLength} bytes)`,
    );
}

function loadDocFromDb(docId, doc) {
    const ORIGIN = "persistence";

    const snap = stmtGetSnapshot.get(docId);
    if (snap?.snapshot_update) {
        Y.applyUpdate(doc, snap.snapshot_update, ORIGIN);
    }

    const updates = stmtGetUpdates.all(docId);
    for (const row of updates) {
        Y.applyUpdate(doc, row.update, ORIGIN);
    }

    if (updates.length > 0) {
        console.log(`[Load] Applied ${updates.length} update rows for ${docId}`);
    }
}

function shutdown() {
    // Flush any pending buffered updates
    for (const [docId] of docMeta) {
        flushPendingUpdates(docId);
    }

    // Stop compaction timers
    for (const [, meta] of docMeta) {
        if (meta.compactTimer) clearInterval(meta.compactTimer);
        if (meta.flushTimer) clearTimeout(meta.flushTimer);
    }

    db.close();
}

module.exports = {
    getOrCreateMeta,
    scheduleFlush,
    startCompactionTimer,
    loadDocFromDb,
    shutdown,
};
