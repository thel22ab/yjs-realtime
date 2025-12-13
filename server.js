// server.js
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer } = require("ws");
const { setupWSConnection } = require("@y/websocket-server/utils");
const Y = require("yjs");
const Database = require("better-sqlite3");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// ---- SQLite ----
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

// ---- Persistence tuning ----
const DEBOUNCE_MS = 500;

// Compact either:
// - every COMPACTION_INTERVAL_MS, OR
// - when we’ve stored a bunch of merged update rows since last compaction.
const COMPACTION_INTERVAL_MS = 60_000;
const COMPACT_EVERY_N_UPDATE_ROWS = 200;

// ---- In-memory buffers ----
// docId -> meta
const docMeta = new Map();
/*
meta = {
  pending: Uint8Array[],
  flushTimer: NodeJS.Timeout | null,
  compactTimer: NodeJS.Timeout | null,
  updateRowsSinceCompact: number,
}
*/

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

function flushPendingUpdates(docId) {
  const meta = docMeta.get(docId);
  if (!meta || meta.pending.length === 0) return;

  // Merge a bunch of tiny updates into one DB row
  const merged = Y.mergeUpdates(meta.pending);
  meta.pending = [];

  stmtInsertUpdate.run(docId, Buffer.from(merged), Date.now());
  meta.updateRowsSinceCompact += 1;

  // If we've accumulated many update rows, compact sooner.
  if (meta.updateRowsSinceCompact >= COMPACT_EVERY_N_UPDATE_ROWS) {
    // We'll compact on next interval tick; or you can call compactNow(docId, doc)
    // if you have access to the doc here.
  }
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

  // 1) Make sure pending debounced updates get written first,
  // otherwise the snapshot might miss recent edits.
  flushPendingUpdates(docId);

  // Optional: skip compaction if we haven't stored many updates
  if (meta && meta.updateRowsSinceCompact === 0) return;

  // 2) Create a snapshot of the whole current state (do this rarely)
  const snapshot = Y.encodeStateAsUpdate(doc);

  // 3) Atomically: save snapshot + clear incremental updates
  txSaveSnapshotAndClearUpdates(docId, Buffer.from(snapshot));

  if (meta) meta.updateRowsSinceCompact = 0;

  console.log(
    `[Compaction] Snapshot saved for ${docId} (${snapshot.byteLength} bytes)`,
  );
}

function loadDocFromDb(docId, doc) {
  // Important: pass an origin so we can ignore these updates in doc.on('update')
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

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    // Route ONLY your Yjs websocket endpoint here.
    // Everything else should be handled by Next (dev HMR etc) or rejected.
    const url = new URL(req.url, `http://${hostname}:${port}`);
    const { pathname } = url;

    // Example: ws://host/yjs/<docId>
    if (!pathname.startsWith("/yjs/")) {
      // In dev, Next may have its own upgrade handler.
      if (dev && typeof app.getUpgradeHandler === "function") {
        return app.getUpgradeHandler()(req, socket, head);
      }
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    const url = new URL(req.url, `http://${hostname}:${port}`);
    const docId = decodeURIComponent(url.pathname.replace(/^\/yjs\//, ""));

    setupWSConnection(ws, req, {
      gc: true,

      // Called when the server creates/loads the in-memory doc
      bindState: async (doc) => {
        // Load from SQLite: snapshot + updates
        loadDocFromDb(docId, doc);

        // Start compaction timer for this doc
        startCompactionTimer(docId, doc);

        // Attach the update listener ONCE per doc (not per client connection)
        if (!doc.__persistenceAttached) {
          doc.__persistenceAttached = true;

          doc.on("update", (update, origin) => {
            if (origin === "persistence") return; // ignore DB replays

            const meta = getOrCreateMeta(docId);
            meta.pending.push(update);
            scheduleFlush(docId);
          });
        }
      },
    });
  });

  process.on("SIGINT", () => {
    console.log("\nShutting down...");

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
    process.exit(0);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Yjs WS endpoint: ws://${hostname}:${port}/yjs/<docId>`);
  });
});