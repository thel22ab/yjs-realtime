// server.ts
/**
 * Custom server for Next.js with Yjs WebSocket support.
 * 
 * This server provides:
 * - Next.js application handling
 * - WebSocket server for Yjs real-time collaboration
 * - SQLite persistence for document state via Prisma
 * 
 * @module server
 */

import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWSConnection, setPersistence, docs } from "@y/websocket-server/utils";
import * as persistence from "./persistence";
import { Doc } from "yjs";

// Export docs for API access
export { docs };

// ---- Configuration Constants ----
const NODE_ENV = process.env.NODE_ENV;
const IS_DEVELOPMENT = NODE_ENV !== "production";
const SERVER_HOSTNAME = "localhost";
const SERVER_PORT = 3000;

// ---- WebSocket Configuration ----
const WEBSOCKET_PATH_PREFIX = "/yjs/";

// ---- Persistence Configuration ----
const PERSISTENCE_MARKER_PREFIX = "__yjs_persistence_";

/**
 * Creates a unique persistence marker for a document.
 * This marker indicates whether persistence has been attached to prevent duplicate listeners.
 */
function createPersistenceMarker(docName: string): string {
    return `${PERSISTENCE_MARKER_PREFIX}${docName}`;
}

/**
 * Type definition for documents that can have persistence markers attached.
 */
interface PersistableDocument {
    [key: string]: boolean | unknown;
}

/**
 * Checks if persistence has already been attached to a document.
 */
function hasPersistenceAttached(doc: Doc, persistenceKey: string): boolean {
    return (doc as unknown as PersistableDocument)[persistenceKey] === true;
}

/**
 * Marks a document as having persistence attached.
 */
function markPersistenceAttached(doc: Doc, persistenceKey: string): void {
    (doc as unknown as PersistableDocument)[persistenceKey] = true;
}

// Lock map to prevent race conditions in bindState
// When multiple clients connect simultaneously to the same doc,
// this ensures only one bindState initialization runs at a time
type DocumentLockPromise = Promise<void>;
const bindStateLocks = new Map<string, DocumentLockPromise>();

// Prepare Next.js app
const app = next({ dev: IS_DEVELOPMENT, hostname: SERVER_HOSTNAME, port: SERVER_PORT });
const handle = app.getRequestHandler();


app.prepare().then(() => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url!, true);
        handle(req, res, parsedUrl);
    });

    // Create WebSocket server
    const wss = new WebSocketServer({ noServer: true });

    // Set up the global persistence handler for @y/websocket-server
    // This must be done before any WebSocket connections
    setPersistence({
        provider: null,

        /**
         * Binds persistence to a Yjs document.
         * This is called when a document is first accessed.
         */
        bindState: async (docName: string, doc: Doc) => {
            console.log(`[bindState] Setting up document: ${docName}`);

            // Use a document-specific persistence key for robustness
            const persistenceKey = createPersistenceMarker(docName);

            // Wait for any existing initialization
            const existingLock = bindStateLocks.get(docName);
            if (existingLock) {
                console.log(`[bindState] Waiting for existing initialization: ${docName}`);
                await existingLock;
                if (hasPersistenceAttached(doc, persistenceKey)) {
                    console.log(`[bindState] Already initialized by another call: ${docName}`);
                    return;
                }
            }

            // Create lock with proper resolver pattern
            let resolveLock!: () => void;
            const lockPromise = new Promise<void>((resolve) => {
                resolveLock = resolve;
            });
            bindStateLocks.set(docName, lockPromise);

            try {
                // Double-check after acquiring lock
                if (hasPersistenceAttached(doc, persistenceKey)) {
                    console.log(`[bindState] Already attached, skipping: ${docName}`);
                    return;
                }

                // Mark as attached BEFORE attaching listener to prevent duplicates
                markPersistenceAttached(doc, persistenceKey);
                console.log(`[bindState] Attaching update listener for: ${docName}`);

                doc.on("update", (update: Uint8Array, origin: unknown) => {
                    if (origin === persistence.YJS_ORIGIN_PERSISTENCE) return;

                    console.log(`[Update] Captured for ${docName}, size: ${update.byteLength}`);

                    const meta = persistence.getOrCreateMeta(docName, doc);
                    meta.pendingUpdates.push(update);
                    persistence.scheduleFlush(docName, doc);
                });

                // Load persisted state from SQLite
                console.log(`[bindState] Loading persisted state for: ${docName}`);
                await persistence.loadDocFromDb(docName, doc);

                // Start periodic compaction
                console.log(`[bindState] Starting compaction timer for: ${docName}`);
                persistence.startCompactionTimer(docName, doc);
            } finally {
                // Release the lock
                bindStateLocks.delete(docName);
                resolveLock();
            }
        },

        /**
         * Writes final state when the last connection closes.
         */
        writeState: async (docName: string, doc: Doc) => {
            // Called when the last connection closes - save and compact the document
            console.log(`[writeState] LAST CONNECTION CLOSED. Saving and compacting document: ${docName}`);
            await persistence.saveAndCompact(docName, doc);
            persistence.stopCompactionTimer(docName);
        },
    });

    // Handle WebSocket upgrades
    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url!, `http://${SERVER_HOSTNAME}:${SERVER_PORT}`);
        const { pathname } = url;

        // Only handle /yjs/* routes for Yjs WebSocket connections here.
        if (!pathname.startsWith(WEBSOCKET_PATH_PREFIX)) {
            // @ts-ignore - Next.js internal method
            if (IS_DEVELOPMENT && typeof app.getUpgradeHandler === "function") {
                // @ts-ignore
                return app.getUpgradeHandler()(req, socket, head);
            }
            socket.destroy();
            return;
        }

        // Upgrade WebSocket connection
        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit("connection", ws, req);
        });
    });

    // Handle Yjs WebSocket connections
    wss.on("connection", (ws, req) => {
        // Extract document ID from URL
        const url = new URL(req.url!, `http://${SERVER_HOSTNAME}:${SERVER_PORT}`);
        const docId = decodeURIComponent(url.pathname.replace(/^\/yjs\//, ""));

        console.log(`[WS] Connection established for doc: ${docId}`);

        ws.on('close', () => {
            console.log(`[WS] Connection closed for doc: ${docId}`);
        });

        // The library will use the global persistence we set above
        setupWSConnection(ws, req, { docName: docId, gc: true });
    });

    // Graceful shutdown
    process.on("SIGINT", () => {
        console.log("\nShutting down...");
        persistence.shutdown().then(() => {
            process.exit(0);
        });
    });

    server.listen(SERVER_PORT, () => {
        console.log(`> Ready on http://${SERVER_HOSTNAME}:${SERVER_PORT}`);
        console.log(`> Yjs WS endpoint: ws://${SERVER_HOSTNAME}:${SERVER_PORT}/yjs/<docId>`);
    });
});
