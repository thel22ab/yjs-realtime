// server.ts
// Custom server for Next.js with Yjs WebSocket support
import "dotenv/config";
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWSConnection, setPersistence } from "@y/websocket-server/utils";
import * as persistence from "./persistence";
import { Doc } from "yjs";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;

// Prepare Next.js app
const app = next({ dev, hostname, port });
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
        bindState: async (docName: string, doc: Doc) => {
            // Load persisted state from SQLite
            await persistence.loadDocFromDb(docName, doc);

            // Start periodic compaction
            persistence.startCompactionTimer(docName, doc);

            // Attach update listener for persistence (once per doc)
            if (!(doc as any).__persistenceAttached) {
                (doc as any).__persistenceAttached = true;

                doc.on("update", (update: Uint8Array, origin: any) => {
                    if (origin === "persistence") return;

                    const meta = persistence.getOrCreateMeta(docName);
                    meta.pending.push(update);
                    persistence.scheduleFlush(docName);
                });
            }
        },
        writeState: async (_docName: string, _doc: Doc) => {
            // Called when the last connection closes
            // We already persist on updates, so nothing extra needed
        },
    });

    // Handle WebSocket upgrades
    server.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url!, `http://${hostname}:${port}`);
        const { pathname } = url;

        // Only handle /yjs/* routes for Yjs WebSocket connections here.
        if (!pathname.startsWith("/yjs/")) {
            // @ts-ignore - Next.js internal method
            if (dev && typeof app.getUpgradeHandler === "function") {
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
        const url = new URL(req.url!, `http://${hostname}:${port}`);
        const docId = decodeURIComponent(url.pathname.replace(/^\/yjs\//, ""));

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

    server.listen(port, () => {
        console.log(`> Ready on http://${hostname}:${port}`);
        console.log(`> Yjs WS endpoint: ws://${hostname}:${port}/yjs/<docId>`);
    });
});

