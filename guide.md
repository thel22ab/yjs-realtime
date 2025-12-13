Building a Real-Time Risk Assessment App with Next.js & Yjs
This guide documents the journey of building a production-ready real-time collaborative application. It covers our architectural choices, the implementation steps, and critically, the specific challenges we faced and overcame.

1. Architecture Overview
To achieve real-time collaboration with persistence, we chose a Hybrid Architecture:

Framework: Next.js 15/16 (App Router) for the frontend and API routes.
Real-Time Engine: Yjs (CRDT library) for handling conflict-free data merging.
Transport: WebSockets for instant updates between clients.
Persistence: SQLite (via better-sqlite3) to save document state.
Server: Custom Node.js Server to host both the Next.js app and the WebSocket server on the same port.
Why this stack?
Standard Next.js Server Actions are great for request/response flows, but real-time collaboration requires long-lived connections (WebSockets). By using a custom server, we can attach a WebSocket server to the same HTTP server that Next.js uses, simplifying deployment (one service to run).

2. Implementation Steps
Step 1: Project Setup & Custom Server
We started by installing the core dependencies: yjs, y-websocket, and better-sqlite3.

The critical piece was 
server.js
. This file replaces the standard next start command. It initializes Next.js but also listens for WebSocket upgrades.

Key Code: Custom Server

// server.js
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
// ... Next.js setup ...
app.prepare().then(() => {
  const server = createServer((req, res) => {
    // Handle Next.js requests
    handle(req, res);
  });
  // Attach WebSocket Server
  const wss = new WebSocketServer({ noServer: true });
  
  server.on('upgrade', (request, socket, head) => {
    // Handle WebSocket upgrades
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
  // Wiring up Yjs
  wss.on('connection', (ws, req) => {
    setupWSConnection(ws, req, { gc: true });
  });
  server.listen(3000);
});
Step 2: Database Layer (SQLite)
We chose SQLite for its simplicity and file-based nature. We used better-sqlite3 and enabled WAL (Write-Ahead Logging) mode for better concurrency support, which is essential when WebSockets might be writing while Server Actions are reading.

Key Code: Persistence

// Inside server.js setupWSConnection callback
setupWSConnection(ws, req, {
  bindState: async (doc) => {
    // 1. Load initial state from DB
    const row = db.prepare('SELECT state_vector FROM ...').get(docName);
    if (row) Y.applyUpdate(doc, row.state_vector);
    // 2. Listen for updates and save
    doc.on('update', () => {
      const update = Y.encodeStateAsUpdate(doc);
      db.prepare('INSERT OR REPLACE ...').run(docName, update);
    });
  }
});
Step 3: The Frontend Editor
We didn't use a rich text editor like ProseMirror. Instead, we built a custom form editor using Yjs primitives:

Y.Map for the CIA dropdowns (Confidentiality, Integrity, Availability).
Y.Text for the Notes field.
Key Code: Binding Data

// RiskAssessmentEditor.tsx
useEffect(() => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, docId, doc);
  // Sync Map (Dropdowns)
  const ciaMap = doc.getMap('cia');
  ciaMap.observe(() => {
    // Update React state when Yjs data changes
    setCia(ciaMap.toJSON());
  });
  // Update Yjs when User changes input
  const handleChange = (key, value) => {
    ciaMap.set(key, value); // Propagates to all users
  };
}, []);
3. Challenges & Solutions (The "Gotchas")
Issue 1: The ws Module
Problem: When first running our custom server, we crashed with Cannot find module 'ws'. Cause: y-websocket uses ws internally in Node.js, but it doesn't always strictly require it as a peer dependency in a way that npm auto-installs it for your top-level usage, or it might be missing if relying on transitives. Solution: Explicitly install it.

npm install ws
Issue 2: The y-websocket Version Mismatch
Problem: We initially encountered Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './bin/utils'. Context: We were trying to import setupWSConnection from y-websocket/bin/utils. Root Cause: y-websocket v2.0+ and especially v3.0+ changed their package exports strategies. The utility scripts located in 
bin/
 were no longer exported for external consumption in the newer versions, or their paths changed significantly. Solution: We downgraded to v1.5.4.

npm install y-websocket@1.5.4
Recommendation: For new projects, check the latest y-websocket documentation. If building a custom server, you might need to copy the utils.js logic into your own project if the library author completely hides it in future versions. For now, v1.5.4 is the stable standard for this specific custom server pattern.

Issue 3: Textarea Synchronization
Problem: Binding a simple <textarea> to Y.Text is tricky. If you just replace the value on every keystroke, you lose cursor position and might overwrite concurrent edits slightly. Our Approach: We used a simple "replace on change" strategy for the demo. Recommendation for Students: For production apps, use a library like y-prosemirror, y-quill, or y-monaco. If you MUST use a plain textarea, you need to calculate the "diff" (delta) between the old value and new value and apply only that delta to the Y.Text to preserve intent.

4. Final Recommendations for Students
Start Simple: Get the WebSocket connection working with a simple counter or existing Yjs demo before building complex UIs.
Understand CRDTs: You don't need to know the math, but understand that Y.Map keys overwrite each other (last write wins), while Y.Text merges character updates.
Persistence Strategy: Saving on every keystroke (as we did) works for demos. For high-scale apps, you should debounce the writes to the database (e.g., save only every 2 seconds or 50 operations) to save I/O resource.
Version Pinning: When following tutorials, pay close attention to library versions. The JS ecosystem moves fast, and major version bumps often break internal imports.
Conclusion
We successfully built a collaborative tools that is robust, persistent, and real-time. This improved architecture using a custom server server provides the solid foundation needed for any collaborative application.