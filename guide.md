# Building a Real-Time Risk Assessment App with Next.js & Yjs

> A comprehensive guide documenting the journey of building a production-ready real-time collaborative application. It covers architectural choices, implementation steps, state management patterns, and critically, the specific challenges we faced and overcame.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Implementation Steps](#2-implementation-steps)
3. [State Management Deep Dive](#3-state-management-deep-dive)
4. [Data Flow & Synchronization](#4-data-flow--synchronization)
5. [Persistence Architecture](#5-persistence-architecture)
6. [Sidecar Architecture Patterns](#6-sidecar-architecture-patterns)
7. [Challenges & Solutions](#7-challenges--solutions-the-gotchas)
8. [Final Recommendations](#8-final-recommendations-for-students)
9. [Offline Editing](#9-offline-editing)
10. [Authentication & Authorization with Auth.js & Entra ID](#10-authentication--authorization-with-authjs--entra-id)

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
npm install yjs y-websocket @y/websocket-server better-sqlite3 ws
```

The critical piece was `server.js`. This file replaces the standard `next start` command. It initializes Next.js but also listens for WebSocket upgrades.

**Key Code: Custom Server**

```javascript
// server.js
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const { setupWSConnection } = require('@y/websocket-server/utils');
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

We built a custom form editor combining **Yjs primitives** with **ProseMirror**:

- **`Y.Map`** for the CIA dropdowns (Confidentiality, Integrity, Availability)
- **`Y.XmlFragment`** with **ProseMirror** for the Notes field

#### Why ProseMirror Even for a Simple Notes Field?

Initially, we tried using a plain `<textarea>` with `Y.Text`. The problem? Standard textareas don't provide character-level change events — only the full value after each keystroke. This forced us to "delete all and re-insert" on every change:

```typescript
// ❌ BAD: Naive textarea approach (defeats CRDT purpose)
ydoc.transact(() => {
  notesText.delete(0, notesText.length);
  notesText.insert(0, newValue);
});
```

This effectively becomes **Last Write Wins** for the entire text block, losing the character-level merging that makes CRDTs valuable.

**ProseMirror solves this** by providing granular transaction-level changes that map perfectly to Yjs operations. The `y-prosemirror` binding handles this automatically:

```typescript
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import { exampleSetup } from 'prosemirror-example-setup';

// Y.XmlFragment instead of Y.Text for ProseMirror
const yXmlFragment = ydoc.getXmlFragment('prosemirror');

const state = EditorState.create({
  schema,
  plugins: [
    ySyncPlugin(yXmlFragment),      // Syncs ProseMirror ↔ Yjs
    yCursorPlugin(awareness),        // Shows remote cursors
    yUndoPlugin(),                   // Undo YOUR changes only
    ...exampleSetup({ schema })
  ]
});

const view = new EditorView(editorRef.current, { state });
```

#### Benefits of ProseMirror + y-prosemirror

| Feature | Plain Textarea | ProseMirror |
|---------|----------------|-------------|
| **Merge concurrent edits** | ❌ Last Write Wins | ✅ Character-level CRDT |
| **Remote cursors** | ❌ Not possible | ✅ See where others are typing |
| **Collaborative undo** | ❌ Global undo | ✅ Undo only your changes |
| **Offline editing** | ✅ Works | ✅ Works (same IndexedDB) |
| **Bundle size** | ~0 KB | ~80 KB |

The ~80KB cost is worth it for **true collaborative editing** where two users can type in the same paragraph simultaneously without conflicts.

**Key Code: CIA Dropdowns (Y.Map)**

```typescript
// Still using Y.Map for simple key-value fields
const ciaMap = ydoc.getMap('cia');
ciaMap.observe(() => {
  setCia({
    confidentiality: ciaMap.get('confidentiality') || 'Low',
    integrity: ciaMap.get('integrity') || 'Low',
    availability: ciaMap.get('availability') || 'Low',
  });
});

const handleCiaChange = (field, value) => {
  ciaMap.set(field, value); // Propagates to all users
};
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

### Simplifying State with SyncedStore

Managing raw Yjs observers and React state synchronization can get verbose. We simplified this using **SyncedStore** — a library that wraps Yjs with a reactive proxy API:

```bash
npm install @syncedstore/core @syncedstore/react
```

**Defining the Store Shape**

```typescript
// lib/store.ts
import { syncedStore, getYjsDoc } from "@syncedstore/core";

interface StoreShape {
    cia: {
        confidentiality?: string;
        integrity?: string;
        availability?: string;
    };
    controls: Record<string, boolean>;
    prosemirror: any; // Special "xml" type for ProseMirror
}

export const createStore = () => syncedStore({
    cia: {},
    controls: {},
    prosemirror: "xml",
}) as StoreShape;

export { getYjsDoc };
```

**Using SyncedStore in React**

```typescript
import { useSyncedStore } from '@syncedstore/react';
import { createStore, getYjsDoc } from '../lib/store';

function RiskAssessmentEditor({ documentId }: Props) {
    // Create a store per document
    const docStore = useMemo(() => createStore(), [documentId]);
    const state = useSyncedStore(docStore);

    // State updates are now reactive — no manual observers!
    const handleCiaChange = (field: keyof typeof state.cia, value: string) => {
        state.cia[field] = value;  // Triggers re-render automatically
    };

    return (
        <select
            value={state.cia.confidentiality || 'Low'}
            onChange={(e) => handleCiaChange('confidentiality', e.target.value)}
        >
            {/* options */}
        </select>
    );
}
```

| Approach | Boilerplate | React Integration | Learning Curve |
|----------|-------------|-------------------|----------------|
| Raw Yjs + observers | High | Manual `useState` sync | Steeper |
| SyncedStore | Low | Automatic via proxy | Gentler |

> **When to use raw Yjs**: If you need fine-grained control over transactions or custom CRDT types. Otherwise, SyncedStore significantly reduces boilerplate.

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

## 5. Persistence Architecture

Our persistence strategy goes beyond simple "save on every keystroke." We implemented a **three-tier system** for durability and efficiency:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      SERVER PERSISTENCE FLOW                             │
│                                                                          │
│  Yjs Update Event                                                        │
│        │                                                                 │
│        ▼                                                                 │
│  ┌──────────────┐    50ms debounce    ┌──────────────────────────────┐  │
│  │ meta.pending │ ─────────────────►  │ flushPendingUpdates()        │  │
│  │   (buffer)   │                     │ → Merge updates              │  │
│  └──────────────┘                     │ → INSERT into document_updates│  │
│                                       └──────────────────────────────┘  │
│                                                   │                      │
│                                                   ▼                      │
│                               ┌──────────────────────────────────────┐  │
│    Every 10 seconds ────────► │ compactDoc()                         │  │
│                               │ → Encode full Y.Doc snapshot         │  │
│                               │ → UPSERT into document_snapshots     │  │
│                               │ → DELETE old document_updates        │  │
│                               │ → UPDATE Document CIA values         │  │
│                               └──────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why This Approach?

| Strategy | Pros | Cons |
|----------|------|------|
| Save every keystroke | Simple, zero data loss | High DB load, slow |
| Save on disconnect only | Minimal DB load | Data loss if server crashes |
| **Debounce + Compaction** | Balanced load, minimal loss | More complex |

### Implementation: Debounced Flushing

Updates are batched into a `pending` array and flushed after 50ms of inactivity:

```typescript
// persistence.ts
export function scheduleFlush(docId: string) {
    const meta = getOrCreateMeta(docId);
    
    if (meta.flushTimer) clearTimeout(meta.flushTimer);
    meta.flushTimer = setTimeout(() => {
        meta.flushTimer = null;
        void flushPendingUpdates(docId);
    }, 50);  // 50ms debounce
}

async function flushPendingUpdates(docId: string) {
    const meta = docMeta.get(docId);
    if (!meta || meta.pending.length === 0) return;

    const merged = Y.mergeUpdates(meta.pending);
    
    try {
        await prisma.documentUpdate.create({
            data: {
                documentId: docId,
                update: Buffer.from(merged),
                createdAt: BigInt(Date.now()),
            },
        });
        // Only clear after successful write to prevent data loss
        meta.pending = [];
    } catch (error) {
        console.error(`Failed to flush:`, error);
        // Keep pending — will retry on next flush
    }
}
```

### Implementation: Periodic Compaction

Every 10 seconds, we compact all pending updates into a single snapshot:

```typescript
export function startCompactionTimer(docId: string, doc: Y.Doc) {
    const meta = getOrCreateMeta(docId);
    if (meta.compactTimer) return;

    meta.compactTimer = setInterval(() => {
        void compactDoc(docId, doc);
    }, 10_000);  // 10 seconds
}

async function compactDoc(docId: string, doc: Y.Doc) {
    await flushPendingUpdates(docId);  // Flush first
    
    const snapshot = Y.encodeStateAsUpdate(doc);
    
    // Extract CIA values for the sidecar Document table
    const ciaMap = doc.getMap('cia');
    const cia = ciaMap.toJSON();
    
    await prisma.$transaction([
        prisma.documentSnapshot.upsert({
            where: { documentId: docId },
            update: { snapshot: Buffer.from(snapshot), updatedAt: BigInt(Date.now()) },
            create: { documentId: docId, snapshot: Buffer.from(snapshot), updatedAt: BigInt(Date.now()) },
        }),
        prisma.documentUpdate.deleteMany({ where: { documentId: docId } }),
        prisma.document.update({
            where: { id: docId },
            data: {
                confidentiality: ciaToInt(cia.confidentiality),
                integrity: ciaToInt(cia.integrity),
                availability: ciaToInt(cia.availability),
            },
        }),
    ]);
}
```

### Cleanup on Disconnect

To prevent memory leaks, we stop timers when all clients disconnect:

```typescript
// server.ts
setPersistence({
    bindState: async (docName, doc) => {
        await persistence.loadDocFromDb(docName, doc);
        persistence.startCompactionTimer(docName, doc);
    },
    writeState: async (docName, _doc) => {
        // Called when last client disconnects
        persistence.stopCompactionTimer(docName);
    },
});
```

### Database Schema (Prisma)

```prisma
model Document {
    id              String   @id
    title           String
    confidentiality Int      @default(0)
    integrity       Int      @default(0)
    availability    Int      @default(0)
    
    snapshot DocumentSnapshot?
    updates  DocumentUpdate[]
}

model DocumentSnapshot {
    documentId String   @id
    document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
    snapshot   Bytes
    updatedAt  BigInt
}

model DocumentUpdate {
    id         Int      @id @default(autoincrement())
    documentId String
    document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
    update     Bytes
    createdAt  BigInt
    
    @@index([documentId, id])
}
```

> **Note**: The `onDelete: Cascade` ensures that when a Document is deleted, its snapshots and updates are automatically cleaned up.

---

## 6. Sidecar Architecture Patterns

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

## 7. Challenges & Solutions (The "Gotchas")

### Issue 1: The `ws` Module

**Problem**: When first running our custom server, we crashed with `Cannot find module 'ws'`.

**Cause**: `y-websocket` uses `ws` internally in Node.js, but it doesn't always strictly require it as a peer dependency in a way that npm auto-installs it for your top-level usage.

**Solution**: Explicitly install it.

```bash
npm install ws
```

---

### Issue 2: The `y-websocket` Server Utilities

**Problem**: You might encounter `Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './bin/utils'` when trying to import `setupWSConnection`.

**Context**: Historically, tutorials recommended importing `setupWSConnection` from `y-websocket/bin/utils`. This was always a bit fragile because `bin/` paths aren't meant for external consumption.

**Root Cause**: As of `y-websocket@3.0.0` (April 2025), the server-side utilities have been **officially extracted** into a separate package: `@y/websocket-server`. This package now lives in its own [repository](https://github.com/yjs/y-websocket-server) and is the recommended way to build custom Yjs WebSocket servers.

**Solution**: Install the new server package:

```bash
npm install @y/websocket-server
```

Then import from the new location:

```javascript
// ✅ NEW (recommended)
const { setupWSConnection, setPersistence } = require('@y/websocket-server/utils');

// ❌ OLD (no longer works in y-websocket@2.0+)
// const { setupWSConnection } = require('y-websocket/bin/utils');
```

**Why the split?** The `y-websocket` package is now purely a **client-side** WebSocket provider ($0$ server dependencies), while `@y/websocket-server` handles the **server-side** connection management. This separation:

- Reduces bundle size for client-only apps
- Makes the server code forkable and customizable
- Provides cleaner exports without relying on internal paths

> **Note**: If you find older tutorials recommending `y-websocket@1.5.4` to access `bin/utils`, that workaround is now outdated. Use `@y/websocket-server` instead.

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

### Issue 5: Document Isolation with React Navigation

**Problem**: When navigating between documents (e.g., `/document/abc` → `/document/xyz`), edits made in one document would sometimes appear in another document.

**Cause**: React reuses component instances when navigating between routes with the same component. The Yjs document and WebSocket provider from the previous route would persist and potentially receive updates meant for the new document.

**Solution**: Add a `key` prop to force React to destroy and recreate the component when the document ID changes:

```tsx
// ❌ BAD: React may reuse the component instance
<RiskAssessmentEditor documentId={id} userName={userName} />

// ✅ GOOD: Forces full remount on ID change
<RiskAssessmentEditor key={id} documentId={id} userName={userName} />
```

**Why this works**: The `key` prop tells React that this is a fundamentally different component instance. When the key changes, React will:
1. Unmount the old component (running cleanup effects)
2. Mount a fresh component (creating new Yjs doc, providers, etc.)

This is the recommended React pattern for components that manage external subscriptions or stateful resources tied to a prop.

---

### Issue 6: SyncedStore Proxy with y-prosemirror

**Problem**: When using SyncedStore, passing `state.prosemirror` directly to `ySyncPlugin()` caused issues because SyncedStore returns a **reactive proxy** rather than the raw Yjs type.

**Symptom**: ProseMirror might not detect changes correctly, or you may see type errors.

**Solution**: Get the raw `Y.XmlFragment` directly from the underlying Yjs document:

```typescript
// ❌ BAD: Passing the proxy
const yXmlFragment = state.prosemirror;
ySyncPlugin(yXmlFragment);  // May not work correctly

// ✅ GOOD: Get raw Yjs type directly
const ydoc = getYjsDoc(docStore);
const yXmlFragment = ydoc.getXmlFragment('prosemirror');
ySyncPlugin(yXmlFragment);  // Works correctly
```

**Rule of thumb**: Use SyncedStore's reactive state for React rendering (`state.cia.confidentiality`), but use raw Yjs types for library integrations (`ydoc.getXmlFragment()`).

---

### Issue 7: Shutdown Flush - Missing Doc Objects

**Problem**: During server shutdown, we call `persistence.shutdown()` to flush buffered updates to the database. However, the `shutdown()` function was only passing the `docId` to `flushPendingUpdates()`, not the `Y.Doc` object itself.

**Impact**: Because `flushPendingUpdates()` needs the `Y.Doc` to extract and sync "sidecar" metadata (like CIA security labels), these values were NOT being synced during a graceful shutdown. Only the binary Yjs updates were saved.

**Solution**: Track the active `Y.Doc` objects within the persistence layer metadata.

```typescript
// persistence.ts
interface DocMeta {
    pending: Uint8Array[];
    doc?: Y.Doc; // Track doc object
    // ...
}

export async function shutdown() {
    for (const [docId, meta] of docMeta) {
        // Now we can pass meta.doc to ensure CIA sync!
        await flushPendingUpdates(docId, meta.doc);
    }
}
```

**Key Takeaway**: When building persistence for Yjs, distinguish between the **binary state** (CRDT) and **sidecar metadata** (SQL columns). Ensure your shutdown handlers have access to the full document object if they need to sync both.

---

---

## 8. Final Recommendations for Students

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
// Recommended versions (as of December 2025)
{
  "yjs": "^13.6.x",
  "y-websocket": "^3.0.0",
  "@y/websocket-server": "^0.1.1",
  "better-sqlite3": "^12.x"
}
```

> **Note**: `y-websocket` is now the client-only WebSocket provider. For server-side utilities like `setupWSConnection`, use `@y/websocket-server`.

### Production Checklist

- [ ] Add authentication to WebSocket connections
- [ ] Implement room/document access control
- [ ] Add connection retry logic with exponential backoff
- [ ] Monitor WebSocket connection counts
- [ ] Set up database backups for SQLite file

---

## 9. Offline Editing

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

## 10. Authentication & Authorization with Auth.js & Entra ID

As you move from demo to production, securing your collaborative rooms becomes priority #1. We leverage **Auth.js (formerly NextAuth.js)** with **Microsoft Entra ID** to ensure only authorized users can connect to the WebSocket server.

### 10.1 Configuring Microsoft Entra ID

First, you must register your application in the [Microsoft Entra admin center](https://entra.microsoft.com/):

1.  **Register App**: Identity > Applications > App Registrations > New Registration.
2.  **Name**: Give it a descriptive name (e.g., `Risk Assessment App`).
3.  **Redirect URI**: Select "Web" and add:
    `http://localhost:3000/api/auth/callback/microsoft-entra-id`
4.  **Secrets**: Go to "Certificates & secrets", create a "New client secret", and copy the value immediately.
5.  **IDs**: Copy the "Application (client) ID" and "Directory (tenant) ID" from the Overview page.

### 10.2 Next.js Integration (Auth.js v5)

Install the necessary dependencies:

```bash
npm install next-auth@beta @auth/core
```

Configure your `auth.ts` (or `api/auth/[...nextauth]/route.ts`):

```typescript
// auth.ts
import NextAuth from "next-auth"
import EntraID from "next-auth/providers/microsoft-entra-id"

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    EntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
    }),
  ],
  session: { strategy: "jwt" }, // JWT is required for WebSocket bridging
})
```

Add your environment variables:

```env
AUTH_SECRET="your-secret-key"
AUTH_MICROSOFT_ENTRA_ID_ID="your-client-id"
AUTH_MICROSOFT_ENTRA_ID_SECRET="your-client-secret"
AUTH_MICROSOFT_ENTRA_ID_ISSUER="https://login.microsoftonline.com/{tenant-id}/v2.0"
```

### 10.3 Securing WebSockets (The WebSocket Bridge)

The standard `auth()` helper works great for HTTP requests, but WebSockets are tricky. The browsers' standard `WebSocket` API **does not support custom headers**, so you cannot easily pass a Bearer token.

**The Solution**: When the browser initiates the WebSocket connection, it sends an HTTP `GET` request with an `Upgrade` header. This request **includes cookies**. We can use `decode` from `next-auth/jwt` to verify the session cookie manually on the server.

**Implementation: Custom Server Authentication**

```javascript
// server.js
const { decode } = require("next-auth/jwt");
const { parse } = require("cookie");

server.on('upgrade', async (request, socket, head) => {
  try {
    // 1. Parse cookies from the upgrade request
    const cookies = parse(request.headers.cookie || "");
    const sessionToken = cookies["authjs.session-token"] || cookies["__Secure-authjs.session-token"];

    if (!sessionToken) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // 2. Decode and verify the JWT
    const user = await decode({
      token: sessionToken,
      secret: process.env.AUTH_SECRET,
    });

    if (!user) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // 3. Attach user info to the request for later use in setupWSConnection
    request.user = user;

    // 4. Continue with regular upgrade
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } catch (err) {
    socket.destroy();
  }
});
```

### 10.4 Client-Side Identity & Awareness

Once authenticated, your client should pass the user's name and email to the Yjs Awareness protocol so other users can see who is editing.

```typescript
// RiskAssessmentEditor.tsx
import { useSession } from "next-auth/react";

function Editor() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.user && provider) {
      provider.awareness.setLocalStateField('user', {
        name: session.user.name,
        email: session.user.email,
        color: getUserColor(session.user.email), // Stable color based on email
      });
    }
  }, [session, provider]);
}
```

### 10.5 Authorization & Access Control (The "Missing Link")

Authentication tells you **who** the user is, but Authorization tells you **what they can do**. In a collaborative app, you must verify that the authenticated user has permission to access the specific document they are requesting.

**The Authorization Flow**:
1.  Extract the `docId` from the WebSocket URL.
2.  Lookup the user's permissions in your database.
3.  Reject the connection *before* the upgrade if unauthorized.

**Implementation: Upgrade Handler with DB Check**

```javascript
// server.ts (continuing from the upgrade handler)
server.on('upgrade', async (request, socket, head) => {
  // ... Authentication logic from 10.3 ...
  const user = await decode({ token: sessionToken, secret: process.env.AUTH_SECRET });

  // 1. Extract Document ID from URL (e.g., /doc/xyz)
  const { pathname } = parse(request.url);
  const docId = pathname.split('/').pop();

  // 2. Database Check (Example using Prisma)
  const hasAccess = await prisma.documentPermission.findFirst({
    where: {
      documentId: docId,
      userId: user.sub, // 'sub' is the unique user ID from Auth.js
      role: { in: ['OWNER', 'EDITOR', 'VIEWER'] }
    }
  });

  if (!hasAccess) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  // 3. Success! Allow the connection
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});
```

> [!TIP]
> **Performance Tip**: Since the `upgrade` handler is called for every connection, cache the authorization results in **Redis** with a short TTL (e.g., 5 minutes) to avoid hitting your primary database on every reconnect.

> [!IMPORTANT]
> Always use a central `AUTH_SECRET` shared between your Next.js application and your custom WebSocket server. If they don't share the same secret, the WebSocket server won't be able to decode the session cookie generated by Next.js.

---

## Conclusion

We successfully built a collaborative tool that is **robust**, **persistent**, and **real-time**. The architecture using a custom server provides the solid foundation needed for any collaborative application.

The key insight is that state management in real-time apps requires thinking in **layers**: local state for responsiveness, shared Yjs state for consistency, and persistent storage for durability. Master this mental model, and you can build any collaborative feature.

---

*Happy coding! 🚀*