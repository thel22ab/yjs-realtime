// server.js
// Custom server for Next.js with Yjs WebSocket support

const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocketServer } = require("ws");
const { setupWSConnection } = require("@y/websocket-server/utils");

const persistence = require("./persistence");

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  });

  // Create WebSocket server
  const wss = new WebSocketServer({ noServer: true });

  // Handle WebSocket upgrades
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, `http://${hostname}:${port}`);
    const { pathname } = url;

    // Only handle /yjs/* routes for Yjs WebSocket connections here.
    if (!pathname.startsWith("/yjs/")) {
      if (dev && typeof app.getUpgradeHandler === "function") {
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
    const url = new URL(req.url, `http://${hostname}:${port}`);
    const docId = decodeURIComponent(url.pathname.replace(/^\/yjs\//, ""));

    setupWSConnection(ws, req, {
      gc: true,

      bindState: async (doc) => {
        // Load persisted state from SQLite
        persistence.loadDocFromDb(docId, doc);

        // Start periodic compaction
        persistence.startCompactionTimer(docId, doc);

        // Attach update listener for persistence (once per doc)
        if (!doc.__persistenceAttached) {
          doc.__persistenceAttached = true;

          doc.on("update", (update, origin) => {
            if (origin === "persistence") return;

            const meta = persistence.getOrCreateMeta(docId);
            meta.pending.push(update);
            persistence.scheduleFlush(docId);
          });
        }
      },
    });
  });

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    persistence.shutdown();
    process.exit(0);
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Yjs WS endpoint: ws://${hostname}:${port}/yjs/<docId>`);
  });
});