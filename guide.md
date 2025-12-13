# Building a Real-Time Risk Assessment App with Next.js & Yjs

> A comprehensive guide documenting the journey of building a production-ready real-time collaborative application. It covers architectural choices, implementation steps, state management patterns, and critically, the specific challenges we faced and overcame.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Implementation Steps](#2-implementation-steps)
3. [State Management Deep Dive](#3-state-management-deep-dive)
4. [Data Flow & Synchronization](#4-data-flow--synchronization)
5. [Sidecar Architecture Patterns](#5-sidecar-architecture-patterns)
6. [Challenges & Solutions](#6-challenges--solutions-the-gotchas)
7. [Final Recommendations](#7-final-recommendations-for-students)
8. [Offline Editing](#8-offline-editing)

---

## 1. Architecture Overview

To achieve real-time collaboration with persistence, we chose a **Hybrid Architecture**:

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Framework** | Next.js 15/16 (App Router) | Frontend UI and API routes |
| **Real-Time Engine** | Yjs (CRDT library) | Conflict-free data merging |
| **Transport** | WebSockets | Instant updates between clients |
| **Persistence** | SQLite (via `better-sqlite3`) | Durable document state |
| **Server** | Custom Node.js Server | Unified hosting for Next.js + WebSockets |

### Why This Stack?

Standard Next.js Server Actions are great for request/response flows, but real-time collaboration requires **long-lived connections** (WebSockets). By using a custom server, we can attach a WebSocket server to the same HTTP server that Next.js uses, simplifying deployment to a single service.

---

## 2. Implementation Steps

### Step 1: Project Setup & Custom Server

We started by installing the core dependencies:

```bash
npm install yjs y-websocket@1.5.4 better-sqlite3 ws
```

The critical piece was `server.js`. This file replaces the standard `next start` command. It initializes Next.js but also listens for WebSocket upgrades.

**Key Code: Custom Server**

```javascript
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
```

---

### Step 2: Database Layer (SQLite)

We chose SQLite for its simplicity and file-based nature. We used `better-sqlite3` and enabled **WAL (Write-Ahead Logging)** mode for better concurrency support, which is essential when WebSockets might be writing while Server Actions are reading.

**Key Code: Persistence**

```javascript
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
```

---

### Step 3: The Frontend Editor

We didn't use a rich text editor like ProseMirror. Instead, we built a custom form editor using **Yjs primitives**:

- **`Y.Map`** for the CIA dropdowns (Confidentiality, Integrity, Availability)
- **`Y.Text`** for the Notes field

**Key Code: Binding Data**

```typescript
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
```

---

## 3. State Management Deep Dive

One of the most important aspects of building a real-time app is understanding how state flows through the system. Our application uses a **multi-layered state architecture**.

### The Three Layers of State

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER (React Component)                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │   Local React State                                       │   │
│  │   • useState for cia, notes, connected, users            │   │
│  │   • Provides immediate UI responsiveness                 │   │
│  └───────────────────────┬─────────────────────────────────┘   │
│                          │                                       │
│  ┌───────────────────────▼─────────────────────────────────┐   │
│  │   Yjs Document (Y.Doc)                                    │   │
│  │   • Y.Map('cia') → key-value for dropdowns               │   │
│  │   • Y.Text('notes') → collaborative text                 │   │
│  │   • Source of truth for shared state                     │   │
│  └───────────────────────┬─────────────────────────────────┘   │
└──────────────────────────┼──────────────────────────────────────┘
                           │ WebSocket (real-time sync)
┌──────────────────────────▼──────────────────────────────────────┐
│                    SERVER (Node.js + y-websocket)               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │   In-Memory Y.Doc instances (per document room)          │   │
│  │   • Merges updates from all connected clients            │   │
│  │   • Broadcasts changes to all subscribers                │   │
│  └───────────────────────┬─────────────────────────────────┘   │
│                          │                                       │
│  ┌───────────────────────▼─────────────────────────────────┐   │
│  │   SQLite Database                                         │   │
│  │   • document_snapshots table                             │   │
│  │   • Stores encoded Y.Doc state as BLOB                   │   │
│  │   • Survives server restarts                             │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### React State vs. Yjs State

Understanding the relationship between React's local state and Yjs's shared state is crucial:

| Aspect | React State (`useState`) | Yjs State (`Y.Doc`) |
|--------|--------------------------|---------------------|
| **Scope** | Local to browser tab | Shared across all clients |
| **Persistence** | Lost on page refresh | Persisted to database |
| **Updates** | Immediate, synchronous | Eventually consistent |
| **Purpose** | UI responsiveness | Data synchronization |

### Why Both?

We maintain **both** local React state and Yjs state because:

1. **Immediate Feedback**: When a user types, updating local state first ensures the UI feels responsive
2. **Single Source of Truth**: Yjs is the authoritative source — React state is a *reflection* of it
3. **Observer Pattern**: Yjs notifies React via observers when remote changes arrive

```typescript
// Pattern: Yjs → React (receiving remote changes)
ciaMap.observe(() => {
  setCia({
    confidentiality: ciaMap.get('confidentiality') || 'Low',
    integrity: ciaMap.get('integrity') || 'Low',
    availability: ciaMap.get('availability') || 'Low',
  });
});

// Pattern: React → Yjs (sending local changes)
const handleCiaChange = (field: string, value: string) => {
  const ciaMap = ydoc.getMap('cia');
  ciaMap.set(field, value);  // This triggers the observer above
};
```

### User Presence with Awareness

Yjs provides an **Awareness** protocol for tracking who's connected:

```typescript
const awareness = provider.awareness;
const color = COLORS[Math.floor(Math.random() * COLORS.length)];

// Set local user's info
awareness.setLocalStateField('user', { name: userName, color });

// Listen for changes in who's online
awareness.on('change', () => {
  const states = Array.from(awareness.getStates().values());
  const activeUsers = states.map(s => s.user?.name).filter(Boolean);
  setUsers(activeUsers);
});
```

This is separate from document state — awareness is ephemeral and not persisted.

---

## 4. Data Flow & Synchronization

### How an Edit Propagates

When User A changes the "Confidentiality" dropdown from "Low" to "High":

```
User A's Browser                Server                    User B's Browser
──────────────────             ────────                   ──────────────────
1. onChange fires
   ↓
2. ciaMap.set('confidentiality', 'High')
   ↓
3. WebsocketProvider encodes → ─────────────────────→ 4. Server receives update
   Yjs update binary                                        ↓
                                                      5. Broadcasts to all clients
                                                            │
   ←───────────────────────────────────────────────────────←┘
   ↓
6. Local ciaMap.observe()
   fires (same as remote)         
   ↓                                                   7. User B's ciaMap.observe() fires
7. setCia() updates UI                                    ↓
                                                      8. setCia() updates UI
```

### The CRDT Magic

Yjs uses **CRDTs (Conflict-free Replicated Data Types)** to handle concurrent edits:

- **`Y.Map`**: Last-write-wins per key. If two users change `confidentiality` at the same moment, both get the same final value (deterministically).
- **`Y.Text`**: Character-level merging. If two users type in different positions, both changes are preserved.

---

## 5. Sidecar Architecture Patterns

As your collaborative application grows, you'll need to think about **scaling** and **deployment patterns**. The "sidecar architecture" is a common approach where a specialized, independent service handles real-time synchronization separately from your main application.

### What is a Sidecar?

In our implementation, the WebSocket server embedded in `server.js` *is* effectively a sidecar — it's a distinct responsibility that could be extracted into its own service. The sidecar pattern allows your main application to remain decoupled from real-time data handling complexities.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        PRODUCTION ARCHITECTURE                        │
│                                                                        │
│  ┌────────────────┐       ┌────────────────────────────────────┐     │
│  │   Next.js App  │       │        Yjs Sidecar Service         │     │
│  │   (Stateless)  │       │  ┌──────────────────────────────┐ │     │
│  │                │       │  │    WebSocket Server          │ │     │
│  │  • Pages       │       │  │    (y-websocket or custom)   │ │     │
│  │  • API Routes  │       │  └──────────────┬───────────────┘ │     │
│  │  • Server      │       │                 │                  │     │
│  │    Actions     │       │  ┌──────────────▼───────────────┐ │     │
│  └───────┬────────┘       │  │    Persistence Layer         │ │     │
│          │                │  │    (Redis, Postgres, S3)     │ │     │
│          │ HTTP           │  └──────────────────────────────┘ │     │
│          ▼                └─────────────────┬──────────────────┘     │
│  ┌───────────────┐                          │ WebSocket               │
│  │   Database    │◄─────────────────────────┘                        │
│  │   (Metadata)  │                                                    │
│  └───────────────┘                                                    │
└──────────────────────────────────────────────────────────────────────┘
```

### Network Provider Options

#### Option 1: WebSocket Server (What We Built)

This is the most common approach — a centralized server relays updates between clients:

| Pros | Cons |
|------|------|
| Simple authentication | Single point of failure |
| Works behind firewalls | Requires server infrastructure |
| Easy to add persistence | Latency depends on server location |
| Horizontally scalable via room sharding | |

**Scaling Strategy**: Shard by "room" (document ID). Each server instance handles a subset of documents. Use Redis pub/sub to coordinate if a user needs to access a document on another shard.

#### Option 2: WebRTC (Peer-to-Peer)

With `y-webrtc`, clients communicate directly:

```bash
npm install y-webrtc
```

```typescript
import { WebrtcProvider } from 'y-webrtc';

const provider = new WebrtcProvider('my-room', ydoc, {
  signaling: ['wss://signaling.yjs.dev'], // Still need signaling server
});
```

| Pros | Cons |
|------|------|
| Minimal server infrastructure | NAT traversal can fail |
| Lower latency (direct connection) | Limited room size (~10-20 peers) |
| Better privacy | No built-in persistence |
| Good for small teams | Harder to debug |

> **Note**: Even WebRTC needs a lightweight **signaling server** to help peers discover each other. This is still a sidecar, just a much smaller one.

### Persistence Provider Options

For production, you'll want durable storage beyond SQLite:

| Provider | Use Case | Package |
|----------|----------|---------|
| **IndexedDB** | Client-side offline cache | `y-indexeddb` |
| **Redis** | High-speed server-side cache | `y-redis` |
| **PostgreSQL** | Relational DB integration | `y-postgres` |
| **MongoDB** | Document store | `y-mongodb` |
| **LevelDB** | Embedded key-value | `y-leveldb` |
| **S3/Cloud Storage** | Long-term archival | Custom implementation |

**Hybrid Pattern**: Use IndexedDB on the client for offline support, and PostgreSQL on the server for durability:

```typescript
// Client-side
import { IndexeddbPersistence } from 'y-indexeddb';

const indexeddbProvider = new IndexeddbPersistence(docName, ydoc);
indexeddbProvider.on('synced', () => {
  console.log('Loaded from IndexedDB (offline cache)');
});
```

### Managed Solutions (No Sidecar to Maintain)

If managing your own sidecar feels like too much, several services provide hosted Yjs backends:

| Service | Description | Best For |
|---------|-------------|----------|
| **[Hocuspocus](https://hocuspocus.dev)** | Open-source extensible Node.js server | Self-hosting with plugins |
| **[PartyKit](https://partykit.io)** | Serverless on Cloudflare's edge | Global low-latency apps |
| **[Liveblocks](https://liveblocks.io)** | Fully managed with React hooks | Rapid development |
| **[Y-Sweet](https://github.com/jamsocket/y-sweet)** | Standalone Yjs server with S3 persistence | Simple self-hosting |

**Example: Hocuspocus Server**

```typescript
// hocuspocus-server.ts
import { Server } from '@hocuspocus/server';
import { SQLite } from '@hocuspocus/extension-sqlite';

const server = Server.configure({
  port: 1234,
  extensions: [
    new SQLite({ database: 'db.sqlite' }),
  ],
  async onAuthenticate({ token }) {
    // Verify JWT or API key
    if (!isValidToken(token)) throw new Error('Unauthorized');
  },
});

server.listen();
```

### When to Extract the Sidecar

Our current `server.js` approach (combined Next.js + WebSocket) works great for:

- ✅ Small to medium scale (< 1000 concurrent connections)
- ✅ Single server deployments
- ✅ Simplified development and debugging

Consider extracting to a separate sidecar when:

- ❌ You need to scale Next.js and WebSocket servers independently
- ❌ You're deploying to serverless (Vercel, Netlify) where WebSockets don't work natively
- ❌ You need geographic distribution (edge deployment)
- ❌ You want different teams to own different services

---

## 6. Challenges & Solutions (The "Gotchas")

### Issue 1: The `ws` Module

**Problem**: When first running our custom server, we crashed with `Cannot find module 'ws'`.

**Cause**: `y-websocket` uses `ws` internally in Node.js, but it doesn't always strictly require it as a peer dependency in a way that npm auto-installs it for your top-level usage.

**Solution**: Explicitly install it.

```bash
npm install ws
```

---

### Issue 2: The `y-websocket` Version Mismatch

**Problem**: We initially encountered `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './bin/utils'`.

**Context**: We were trying to import `setupWSConnection` from `y-websocket/bin/utils`.

**Root Cause**: `y-websocket` v2.0+ and especially v3.0+ changed their package exports strategies. The utility scripts located in `bin/` were no longer exported for external consumption.

**Solution**: We downgraded to v1.5.4.

```bash
npm install y-websocket@1.5.4
```

> **Recommendation**: For new projects, check the latest `y-websocket` documentation. If building a custom server, you might need to copy the `utils.js` logic into your own project if the library author completely hides it in future versions.

---

### Issue 3: Textarea Synchronization

**Problem**: Binding a simple `<textarea>` to `Y.Text` is tricky. If you just replace the value on every keystroke, you lose cursor position and might overwrite concurrent edits.

**Our Approach**: We used a transactional "delete-all and insert" strategy for the demo:

```typescript
ydoc?.transact(() => {
  notesText.delete(0, notesText.length);
  notesText.insert(0, newValue);
});
```

**Recommendation for Production**: Use a library like `y-prosemirror`, `y-quill`, or `y-monaco`. If you MUST use a plain textarea, calculate the "diff" (delta) between old and new values and apply only that delta to preserve intent.

---

### Issue 4: Next.js HMR Conflicts

**Problem**: During development, Next.js's Hot Module Replacement (HMR) uses WebSockets on `/_next/webpack-hmr`. Our custom WebSocket server was intercepting these.

**Solution**: Filter out HMR paths in the upgrade handler:

```javascript
server.on('upgrade', (request, socket, head) => {
  const { pathname } = parse(request.url);
  if (pathname?.startsWith('/_next/webpack-hmr')) {
    return; // Let Next.js handle HMR
  }
  wss.handleUpgrade(request, socket, head, handleConnection);
});
```

---

## 7. Final Recommendations for Students

### Getting Started

1. **Start Simple**: Get the WebSocket connection working with a simple counter or existing Yjs demo before building complex UIs.

2. **Understand CRDTs**: You don't need to know the math, but understand that:
   - `Y.Map` keys overwrite each other (last write wins per key)
   - `Y.Text` merges character updates (true collaborative editing)

### Persistence Strategy

Saving on every keystroke (as we did) works for demos. For high-scale apps:

- **Debounce writes** to the database (e.g., every 2 seconds or 50 operations)
- Consider using **incremental updates** instead of full snapshots
- Use **Redis** or a message queue for horizontal scaling

### Version Pinning

When following tutorials, pay close attention to library versions. The JS ecosystem moves fast, and major version bumps often break internal imports.

```json
// Recommended versions (as of this guide)
{
  "yjs": "^13.6.x",
  "y-websocket": "1.5.4",
  "better-sqlite3": "^11.x"
}
```

### Production Checklist

- [ ] Add authentication to WebSocket connections
- [ ] Implement room/document access control
- [ ] Add connection retry logic with exponential backoff
- [ ] Monitor WebSocket connection counts
- [ ] Set up database backups for SQLite file

---

## 8. Offline Editing

To enable offline support, we use `y-indexeddb` to cache the Yjs document in the browser's IndexedDB. This provides a seamless experience where:

1. **Instant Load**: Data loads from IndexedDB immediately, even before the WebSocket connects
2. **Offline Editing**: Users can continue working when disconnected
3. **Automatic Sync**: Changes merge automatically when reconnected

### Installation

```bash
npm install y-indexeddb
```

### Implementation

```typescript
import { IndexeddbPersistence } from 'y-indexeddb';

// Inside your useEffect:
const doc = new Y.Doc();
const wsProvider = new WebsocketProvider(wsUrl, documentId, doc);

// Add IndexedDB persistence
const indexeddbProvider = new IndexeddbPersistence(documentId, doc);
indexeddbProvider.on('synced', () => {
  console.log('Loaded from IndexedDB');
  setOfflineReady(true);
});

// Cleanup
return () => {
  indexeddbProvider.destroy();
  wsProvider.destroy();
  doc.destroy();
};
```

### UI States

With offline support, update your UI to reflect the connection state:

| State | Condition | Display |
|-------|-----------|--------|
| Loading | `!connected && !offlineReady` | "Connecting..." spinner |
| Offline | `!connected && offlineReady` | Amber "Offline Mode" badge |
| Online | `connected` | Green "Synchronized" badge |

### How Sync Works

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│   IndexedDB     │◀───────▶│    Y.Doc        │◀───────▶│   WebSocket     │
│  (Local Cache)  │  sync   │  (In Memory)    │  sync   │   (Server)      │
└─────────────────┘         └─────────────────┘         └─────────────────┘
        ▲                                                        │
        │                  Offline? Still works!                 │
        └────────────────────────────────────────────────────────┘
                            Reconnect? Auto-merges!
```

Both providers sync with the same `Y.Doc`. When offline, IndexedDB preserves all changes. When reconnected, Yjs's CRDT magic merges everything automatically.

---

## Conclusion

We successfully built a collaborative tool that is **robust**, **persistent**, and **real-time**. The architecture using a custom server provides the solid foundation needed for any collaborative application.

The key insight is that state management in real-time apps requires thinking in **layers**: local state for responsiveness, shared Yjs state for consistency, and persistent storage for durability. Master this mental model, and you can build any collaborative feature.

---

*Happy coding! 🚀*