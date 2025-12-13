const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const Y = require('yjs');
const Database = require('better-sqlite3');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = process.env.PORT || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Initialize DB for persistence directly in server.js to avoid TS complexity
const db = new Database('risk-assessments.db');
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS document_snapshots (
    document_id TEXT PRIMARY KEY,
    state_vector BLOB,
    updated_at DATETIME
  )
`);

const stmtInsertSnapshot = db.prepare(`
  INSERT INTO document_snapshots (document_id, state_vector, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(document_id) DO UPDATE SET
    state_vector = excluded.state_vector,
    updated_at = excluded.updated_at
`);

const stmtGetSnapshot = db.prepare(`
  SELECT state_vector FROM document_snapshots WHERE document_id = ?
`);

app.prepare().then(() => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (request, socket, head) => {
        const { pathname } = parse(request.url);
        if (pathname && pathname.startsWith('/_next/webpack-hmr')) {
            // Let Next.js handle HMR
            return;
        }

        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });

    wss.on('connection', (ws, req) => {
        const docName = req.url.slice(1).split('?')[0]; // Simple extraction, might need refinement

        setupWSConnection(ws, req, {
            gc: true,
            bindState: async (doc) => {
                // Load the initial state from the database
                try {
                    const row = stmtGetSnapshot.get(docName);
                    if (row && row.state_vector) {
                        const state = new Uint8Array(row.state_vector);
                        Y.applyUpdate(doc, state);
                    }
                } catch (err) {
                    console.error('Error loading snapshot:', err);
                }

                // Persist updates
                doc.on('update', (update) => {
                    try {
                        const stateVector = Y.encodeStateAsUpdate(doc);
                        stmtInsertSnapshot.run(docName, Buffer.from(stateVector));
                    } catch (err) {
                        console.error('Error saving snapshot:', err);
                    }
                });
            }
        });
    });

    server.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
    });
});
