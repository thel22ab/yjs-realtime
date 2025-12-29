/**
 * SQLite persistence for Yjs documents using Prisma 7.
 * Handles debounced writes, periodic compaction, and CIA synchronization.
 */

import * as Y from "yjs";
import prisma from "./lib/db";

const DEBOUNCE_DELAY_MS = 50;
const COMPACTION_INTERVAL_MS = 10_000;
export const YJS_ORIGIN_PERSISTENCE = "persistence";

// CIA level mapping (string -> numeric for database)
const CIA_LEVELS = { Low: 1, Medium: 2, High: 3, Critical: 3 } as const;
const parseCiaLevel = (value?: string) => (value && CIA_LEVELS[value as keyof typeof CIA_LEVELS]) || 0;

interface DocumentMetadata {
    pendingUpdates: Uint8Array[];
    flushTimer: NodeJS.Timeout | null;
    compactionTimer: NodeJS.Timeout | null;
    updatesSinceLastCompaction: number;
    yjsDocument?: Y.Doc;
}

const documentMetadataMap = new Map<string, DocumentMetadata>();

/** Gets or creates metadata for a document. */
export function getOrCreateMeta(docId: string, yjsDoc?: Y.Doc): DocumentMetadata {
    let meta = documentMetadataMap.get(docId);
    if (!meta) {
        meta = {
            pendingUpdates: [],
            flushTimer: null,
            compactionTimer: null,
            updatesSinceLastCompaction: 0,
            yjsDocument: yjsDoc,
        };
        documentMetadataMap.set(docId, meta);
    } else if (yjsDoc) {
        meta.yjsDocument = yjsDoc;
    }
    return meta;
}

const mergePendingUpdates = (meta: DocumentMetadata) =>
    meta.pendingUpdates.length > 0 ? Y.mergeUpdates(meta.pendingUpdates) : null;

async function persistMergedUpdate(docId: string, mergedUpdate: Uint8Array) {
    await prisma.documentUpdate.create({
        data: {
            documentId: docId,
            update: Buffer.from(mergedUpdate),
            createdAt: BigInt(Date.now()),
        },
    });
}

async function syncDocumentCIAValues(docId: string, doc: Y.Doc) {
    const rawCia = doc.getMap('cia').toJSON();
    const data = {
        confidentiality: parseCiaLevel(rawCia.confidentiality),
        integrity: parseCiaLevel(rawCia.integrity),
        availability: parseCiaLevel(rawCia.availability),
    };

    try {
        // Use upsert with unchecked input to handle the case where the document doesn't exist
        // Also update timestamp on upsert
        await prisma.document.upsert({
            where: { id: docId },
            update: { ...data },
            create: { id: docId, title: docId, ...data },
        });
        console.log(`[CIA Sync] Updated ${docId}: C=${data.confidentiality} I=${data.integrity} A=${data.availability}`);
    } catch (error) {
        logPersistenceError('CIA Sync', docId, error);
    }
}

/**
 * Gets CIA values as update data for transaction use.
 */
function getCIAUpdateData(doc: Y.Doc) {
    const rawCia = doc.getMap('cia').toJSON();
    return {
        confidentiality: parseCiaLevel(rawCia.confidentiality),
        integrity: parseCiaLevel(rawCia.integrity),
        availability: parseCiaLevel(rawCia.availability),
    };
}

/**
 * Logs an error with consistent formatting for persistence operations.
 * 
 * @param operation - The name of the operation that failed
 * @param docId - The document identifier
 * @param error - The error that occurred
 */
function logPersistenceError(operation: string, docId: string, error: unknown): void {
    console.error(`[Persistence][${operation}] Failed for ${docId}:`, error);
}

// ---- Core Persistence Operations ----

/**
 * Flushes all pending updates for a document to the database.
 * This includes merging updates, persisting them, and syncing CIA values.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document containing updates
 * @returns A promise that resolves when flushing is complete
 */
async function flushPendingUpdates(docId: string, doc?: Y.Doc): Promise<void> {
    const meta = documentMetadataMap.get(docId);

    if (!meta || meta.pendingUpdates.length === 0) {
        // Even if no pending binary updates, sync CIA values if we have the document
        if (doc) {
            await syncDocumentCIAValues(docId, doc);
        }
        return;
    }

    console.log(`[Flush] Flushing ${meta.pendingUpdates.length} updates for ${docId}`);

    // Capture snapshot of updates to flush
    const updatesToFlush = [...meta.pendingUpdates];
    const updateCount = updatesToFlush.length;

    // Merge pending updates into a single blob
    const merged = Y.mergeUpdates(updatesToFlush);

    try {
        await persistMergedUpdate(docId, merged);
        
        // Remove only the updates we actually flushed (FIFO)
        // This preserves any new updates that arrived during the await above
        meta.pendingUpdates = meta.pendingUpdates.slice(updateCount);
        
        meta.updatesSinceLastCompaction += 1;
        console.log(`[Flush] Successfully flushed update for ${docId} (${merged.byteLength} bytes)`);

        // Also update CIA values in the sidecar document table
        // Only call if doc is provided (it should be in this code path)
        if (doc) {
            await syncDocumentCIAValues(docId, doc);
        }
    } catch (error) {
        logPersistenceError('Flush', docId, error);
    }
}

/**
 * Schedules a debounced flush of pending updates for a document.
 * 
 * This function implements a debouncing pattern to batch multiple rapid
 * updates into a single database write, improving performance.
 * 
 * @param docId - The unique identifier for the document
 * @param doc - The Yjs document containing updates to flush
 * 
 * @example
 * ```typescript
 * doc.on('update', (update) => {
 *     const meta = getOrCreateMeta(docId, doc);
 *     meta.pendingUpdates.push(update);
 *     scheduleFlush(docId, doc);
 * });
 * ```
 */
export function scheduleFlush(docId: string, doc: Y.Doc): void {
    const meta = getOrCreateMeta(docId, doc);

    console.log(`[Schedule] Scheduling flush for ${docId}, pending: ${meta.pendingUpdates.length}`);

    try {
        if (meta.flushTimer) {
            clearTimeout(meta.flushTimer);
        }
        meta.flushTimer = setTimeout(() => {
            meta.flushTimer = null;
            void flushPendingUpdates(docId, doc);
        }, DEBOUNCE_DELAY_MS);
    } catch (error) {
        logPersistenceError('Timer', docId, error);
        meta.flushTimer = null;
    }
}

/**
 * Starts the periodic compaction timer for a document.
 * Compaction merges all incremental updates into a single snapshot.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to compact
 */
export function startCompactionTimer(docId: string, doc: Y.Doc): void {
    const meta = getOrCreateMeta(docId, doc);
    if (meta.compactionTimer) {
        return;
    }

    try {
        meta.compactionTimer = setInterval(() => {
            void compactDocument(docId, doc);
        }, COMPACTION_INTERVAL_MS);
    } catch (error) {
        logPersistenceError('Timer', docId, error);
        meta.compactionTimer = null;
    }
}

/**
 * Stops all timers associated with a document and cleans up metadata.
 * 
 * @param docId - The document identifier
 */
export function stopCompactionTimer(docId: string): void {
    const meta = documentMetadataMap.get(docId);
    if (!meta) {
        return;
    }

    if (meta.compactionTimer) {
        clearInterval(meta.compactionTimer);
        meta.compactionTimer = null;
    }
    if (meta.flushTimer) {
        clearTimeout(meta.flushTimer);
        meta.flushTimer = null;
    }

    // Clean up metadata
    documentMetadataMap.delete(docId);
}

/**
 * Compacts a document by creating a snapshot and clearing incremental updates.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to compact
 */
async function compactDocument(docId: string, doc: Y.Doc): Promise<void> {
    const meta = documentMetadataMap.get(docId);

    // Ensure everything pending is written first
    await flushPendingUpdates(docId, doc);

    if (meta && meta.updatesSinceLastCompaction === 0) {
        return;
    }

    const snapshot = Y.encodeStateAsUpdate(doc);
    const snapshotBuffer = Buffer.from(snapshot);
    const currentTimestamp = BigInt(Date.now());

    // Get CIA values before transaction for atomicity
    const ciaData = getCIAUpdateData(doc);

    try {
        console.log(`[Compaction] Executing transaction for ${docId}`);

        // Transaction: Save Snapshot + Delete Updates + Sync CIA values atomically
        await prisma.$transaction([
            prisma.documentSnapshot.upsert({
                where: { documentId: docId },
                update: {
                    snapshot: snapshotBuffer,
                    updatedAt: currentTimestamp,
                },
                create: {
                    documentId: docId,
                    snapshot: snapshotBuffer,
                    updatedAt: currentTimestamp,
                },
            }),
            prisma.documentUpdate.deleteMany({
                where: { documentId: docId },
            }),
            // Include CIA sync in transaction for atomicity
            prisma.document.upsert({
                where: { id: docId },
                update: { ...ciaData },
                create: { id: docId, title: docId, ...ciaData },
            }),
        ]);

        if (meta) {
            meta.updatesSinceLastCompaction = 0;
        }

        console.log(`[Compaction] Success: ${docId}`);
    } catch (error) {
        logPersistenceError('Compaction', docId, error);
    }
}

// ---- Public API ----

/**
 * Saves and compacts a document.
 * Called when a document is closed or the server is shutting down.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to save
 */
export async function saveAndCompact(docId: string, doc: Y.Doc): Promise<void> {
    console.log(`[SaveAndCompact] Saving document on close: ${docId}`);

    // Flush any pending updates and update CIA values
    await flushPendingUpdates(docId, doc);

    // Force compaction regardless of updateRowsSinceCompact
    const meta = documentMetadataMap.get(docId);
    if (meta) {
        // Temporarily set to 1 to force compaction if needed
        const hadUpdates = meta.updatesSinceLastCompaction;
        meta.updatesSinceLastCompaction = 1;
        await compactDocument(docId, doc);
        if (hadUpdates === 0) {
            // Log that we saved even if no new updates
            console.log(`[SaveAndCompact] Document ${docId} saved (no pending updates)`);
        }
    } else {
        // No meta means fresh document, still try to compact
        await compactDocument(docId, doc);
    }
}

/**
 * Forces an immediate flush and compaction for a document.
 * Useful for testing or critical save operations.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to flush
 */
export async function forceFlush(docId: string, doc: Y.Doc): Promise<void> {
    console.log(`[ForceFlush] Force saving document: ${docId}`);
    await flushPendingUpdates(docId, doc);
    await compactDocument(docId, doc);
}

/**
 * Loads a document's persisted state from the database.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to populate with persisted data
 */
export async function loadDocFromDb(docId: string, doc: Y.Doc): Promise<void> {
    try {
        // Load Snapshot
        const snapshotRecord = await prisma.documentSnapshot.findUnique({
            where: { documentId: docId },
        });

        if (snapshotRecord?.snapshot) {
            Y.applyUpdate(doc, new Uint8Array(snapshotRecord.snapshot), YJS_ORIGIN_PERSISTENCE);
        }

        // Load Updates
        const updates = await prisma.documentUpdate.findMany({
            where: { documentId: docId },
            orderBy: { id: "asc" },
        });

        for (const row of updates) {
            Y.applyUpdate(doc, new Uint8Array(row.update), YJS_ORIGIN_PERSISTENCE);
        }

        if (updates.length > 0) {
            console.log(`[Load] Applied ${updates.length} update rows for ${docId}`);
        }
    } catch (error) {
        logPersistenceError('Load', docId, error);
    }
}

/**
 * Shuts down the persistence layer gracefully.
 * Flushes all pending updates and stops all timers.
 * 
 * @returns A promise that resolves when shutdown is complete
 */
export async function shutdown(): Promise<void> {
    // Flush any pending buffered updates
    const flushPromises: Promise<void>[] = [];
    for (const [docId, meta] of documentMetadataMap) {
        // Pass the tracked document object to ensure CIA values are synced
        if (meta.yjsDocument) {
            flushPromises.push(flushPendingUpdates(docId, meta.yjsDocument));
        }
    }
    await Promise.all(flushPromises);

    // Stop compaction timers
    for (const [, meta] of documentMetadataMap) {
        if (meta.compactionTimer) {
            clearInterval(meta.compactionTimer);
        }
        if (meta.flushTimer) {
            clearTimeout(meta.flushTimer);
        }
    }

    await prisma.$disconnect();
}
