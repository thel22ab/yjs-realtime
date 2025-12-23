// persistence.ts
// Handles SQLite persistence for Yjs documents using Prisma 7

import * as Y from "yjs";
import prisma from "./lib/db";

// ---- Tuning Constants ----
const DEBOUNCE_MS = 50;
const COMPACTION_INTERVAL_MS = 10_000; // 10 seconds for testing (normally 60_000)

// ---- In-memory Document Metadata ----
interface DocMeta {
    pending: Uint8Array[];
    flushTimer: NodeJS.Timeout | null;
    compactTimer: NodeJS.Timeout | null;
    updateRowsSinceCompact: number;
}

const docMeta = new Map<string, DocMeta>();

export function getOrCreateMeta(docId: string): DocMeta {
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

async function flushPendingUpdates(docId: string) {
    const meta = docMeta.get(docId);
    if (!meta || meta.pending.length === 0) return;

    console.log(`[Flush] Flushing ${meta.pending.length} updates for ${docId}`);

    // Merge pending updates into a single blob
    const merged = Y.mergeUpdates(meta.pending);

    try {
        await prisma.documentUpdate.create({
            data: {
                documentId: docId,
                update: Buffer.from(merged),
                createdAt: BigInt(Date.now()),
            },
        });
        // Only clear pending after successful write to prevent data loss
        meta.pending = [];
        meta.updateRowsSinceCompact += 1;
        console.log(`[Flush] Successfully flushed update for ${docId} (${merged.byteLength} bytes)`);
    } catch (error) {
        console.error(`[Persistence] Failed to flush updates for ${docId}:`, error);
        // Pivot: put them back? or just log error? For now, log.
    }
}

export function scheduleFlush(docId: string) {
    const meta = getOrCreateMeta(docId);

    console.log(`[Schedule] Scheduling flush for ${docId}, pending: ${meta.pending.length}`);

    if (meta.flushTimer) clearTimeout(meta.flushTimer);
    meta.flushTimer = setTimeout(() => {
        meta.flushTimer = null;
        void flushPendingUpdates(docId);
    }, DEBOUNCE_MS);
}

export function startCompactionTimer(docId: string, doc: Y.Doc) {
    const meta = getOrCreateMeta(docId);
    if (meta.compactTimer) return;

    meta.compactTimer = setInterval(() => {
        void compactDoc(docId, doc);
    }, COMPACTION_INTERVAL_MS);
}

export function stopCompactionTimer(docId: string) {
    const meta = docMeta.get(docId);
    if (!meta) return;

    if (meta.compactTimer) {
        clearInterval(meta.compactTimer);
        meta.compactTimer = null;
    }
    if (meta.flushTimer) {
        clearTimeout(meta.flushTimer);
        meta.flushTimer = null;
    }
}

// Convert CIA string value to integer (0-3)
function ciaStringToInt(value: unknown): number {
    switch (value) {
        case 'Low': return 1;
        case 'Medium': return 2;
        case 'High': return 3;
        case 'Critical': return 3; // Map Critical to High (3)
        default: return 0; // Not set
    }
}

async function compactDoc(docId: string, doc: Y.Doc) {
    const meta = docMeta.get(docId);

    // Ensure everything pending is written first (optional, but good practice)
    await flushPendingUpdates(docId);

    if (meta && meta.updateRowsSinceCompact === 0) return;

    const snapshot = Y.encodeStateAsUpdate(doc);
    const snapshotBuf = Buffer.from(snapshot);
    const now = BigInt(Date.now());

    // Extract CIA values from the Yjs document
    const ciaMap = doc.getMap('cia');
    const rawCia = ciaMap.toJSON();
    const confidentiality = ciaStringToInt(rawCia.confidentiality);
    const integrity = ciaStringToInt(rawCia.integrity);
    const availability = ciaStringToInt(rawCia.availability);

    try {
        // Transaction: Save Snapshot + Delete Updates + Update Document CIA
        await prisma.$transaction([
            prisma.documentSnapshot.upsert({
                where: { documentId: docId },
                update: {
                    snapshot: snapshotBuf,
                    updatedAt: now,
                },
                create: {
                    documentId: docId,
                    snapshot: snapshotBuf,
                    updatedAt: now,
                },
            }),
            prisma.documentUpdate.deleteMany({
                where: { documentId: docId },
            }),
            // Update the document's CIA values
            prisma.document.update({
                where: { id: docId },
                data: {
                    confidentiality,
                    integrity,
                    availability,
                },
            }),
        ]);

        if (meta) meta.updateRowsSinceCompact = 0;

        console.log(`[Compaction] Success: ${docId} (C=${confidentiality} I=${integrity} A=${availability})`);
    } catch (error) {
        console.error(`[Compaction] FAILED for ${docId}:`, error);
    }
}

// Public function to save and compact a document (called when document is closed)
export async function saveAndCompact(docId: string, doc: Y.Doc) {
    console.log(`[SaveAndCompact] Saving document on close: ${docId}`);

    // Flush any pending updates first
    await flushPendingUpdates(docId);

    // Force compaction regardless of updateRowsSinceCompact
    const meta = docMeta.get(docId);
    if (meta) {
        // Temporarily set to 1 to force compaction if needed
        const hadUpdates = meta.updateRowsSinceCompact;
        meta.updateRowsSinceCompact = 1;
        await compactDoc(docId, doc);
        if (hadUpdates === 0) {
            // Still log that we saved even if no new updates
            console.log(`[SaveAndCompact] Document ${docId} saved (no pending updates)`);
        }
    } else {
        // No meta means fresh document, still try to compact
        await compactDoc(docId, doc);
    }
}

export async function loadDocFromDb(docId: string, doc: Y.Doc) {
    const ORIGIN = "persistence";

    try {
        // Load Snapshot
        const snap = await prisma.documentSnapshot.findUnique({
            where: { documentId: docId },
        });

        if (snap?.snapshot) {
            Y.applyUpdate(doc, new Uint8Array(snap.snapshot), ORIGIN);
        }

        // Load Updates
        const updates = await prisma.documentUpdate.findMany({
            where: { documentId: docId },
            orderBy: { id: "asc" },
        });

        for (const row of updates) {
            Y.applyUpdate(doc, new Uint8Array(row.update), ORIGIN);
        }

        if (updates.length > 0) {
            console.log(`[Load] Applied ${updates.length} update rows for ${docId}`);
        }
    } catch (error) {
        console.error(`[Load] Failed to load doc ${docId}:`, error);
    }
}

export async function shutdown() {
    // Flush any pending buffered updates
    const flushPromises = [];
    for (const [docId] of docMeta) {
        flushPromises.push(flushPendingUpdates(docId));
    }
    await Promise.all(flushPromises);

    // Stop compaction timers
    for (const [, meta] of docMeta) {
        if (meta.compactTimer) clearInterval(meta.compactTimer);
        if (meta.flushTimer) clearTimeout(meta.flushTimer);
    }

    await prisma.$disconnect();
}
