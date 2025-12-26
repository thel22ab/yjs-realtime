// persistence.ts
/**
 * Handles SQLite persistence for Yjs documents using Prisma 7.
 * 
 * This module provides:
 * - Document metadata tracking with pending updates
 * - Debounced flush operations for batched writes
 * - Periodic compaction to optimize storage
 * - Projection plugin system for syncing Yjs state to relational tables
 * 
 * @module persistence
 */

import * as Y from "yjs";
import { Mutex } from "async-mutex";
import prisma from "./lib/db";
import { projectionManager, ciaProjection } from "./persistence/projections";
import type { ProjectionTrigger } from "./persistence/projections";

// ---- Configuration Constants ----

/** Delay in milliseconds for debouncing flush operations. */
const DEBOUNCE_DELAY_MS = 50;

/** Interval in milliseconds for periodic compaction (10 seconds for testing, normally 60000). */
const COMPACTION_INTERVAL_MS = 10_000;

/** Interval in milliseconds for automatic version creation (60 seconds). */
const AUTO_VERSION_INTERVAL_MS = 60_000;

/** Origin identifier for updates applied from persistence layer. */
export const YJS_ORIGIN_PERSISTENCE = "persistence";

// ---- Register Projections ----

// Register CIA projection on module load
projectionManager.register(ciaProjection);

// ---- In-memory Document Metadata ----

/**
 * Metadata tracked for each active document.
 * Manages pending updates, timers, compaction state, and per-doc mutex.
 */
interface DocumentMetadata {
    /** Array of pending updates waiting to be flushed to the database. */
    pendingUpdates: Uint8Array[];

    /** Timer for debounced flush operations. */
    flushTimer: NodeJS.Timeout | null;

    /** Timer for periodic compaction operations. */
    compactionTimer: NodeJS.Timeout | null;

    /** Number of update rows written since the last compaction. */
    updatesSinceLastCompaction: number;

    /** Reference to the Yjs document for operations. */
    yjsDocument?: Y.Doc;

    /** Per-document mutex for serializing all DB writes. */
    mutex: Mutex;

    /** Whether persistence listener has been attached. */
    listenerAttached: boolean;

    /** Timestamp of last version creation. */
    lastVersionCreatedAt: number;
}

/** Map of document IDs to their metadata. */
const documentMetadataMap = new Map<string, DocumentMetadata>();

/**
 * Retrieves existing metadata for a document or creates new metadata if none exists.
 * 
 * @param docId - The unique identifier for the document
 * @param yjsDoc - Optional Yjs document reference to associate with the metadata
 * @returns The document metadata
 */
export function getOrCreateMeta(docId: string, yjsDoc?: Y.Doc): DocumentMetadata {
    let meta = documentMetadataMap.get(docId);
    if (!meta) {
        meta = {
            pendingUpdates: [],
            flushTimer: null,
            compactionTimer: null,
            updatesSinceLastCompaction: 0,
            yjsDocument: yjsDoc,
            mutex: new Mutex(),
            listenerAttached: false,
            lastVersionCreatedAt: 0,
        };
        documentMetadataMap.set(docId, meta);
    } else if (yjsDoc) {
        // Update document reference if provided
        meta.yjsDocument = yjsDoc;
    }
    return meta;
}

// ---- Persistence Helper Functions ----

/**
 * Merges all pending updates for a document into a single update blob.
 * 
 * @param meta - The document metadata containing pending updates
 * @returns The merged update blob, or null if no updates are pending
 */
function mergePendingUpdates(meta: DocumentMetadata): Uint8Array | null {
    if (meta.pendingUpdates.length === 0) {
        return null;
    }
    return Y.mergeUpdates(meta.pendingUpdates);
}

/**
 * Persists a merged update blob to the database.
 * 
 * @param docId - The document identifier
 * @param mergedUpdate - The merged update blob to persist
 * @returns A promise that resolves when the update is persisted
 */
async function persistMergedUpdate(docId: string, mergedUpdate: Uint8Array): Promise<void> {
    await prisma.documentUpdate.create({
        data: {
            documentId: docId,
            update: Buffer.from(mergedUpdate),
            createdAt: BigInt(Date.now()),
        },
    });
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
 * Runs projections for a given trigger.
 * Internal helper - must be called under mutex.
 */
async function runProjectionsInternal(
    docId: string,
    doc: Y.Doc,
    trigger: ProjectionTrigger
): Promise<void> {
    await projectionManager.runProjections(docId, doc, trigger, prisma);
}

/**
 * Flushes all pending updates for a document to the database.
 * This includes merging updates, persisting them, and running flush-triggered projections.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document containing updates
 * @returns A promise that resolves when flushing is complete
 */
async function flushPendingUpdates(docId: string, doc?: Y.Doc): Promise<void> {
    const meta = documentMetadataMap.get(docId);

    if (!meta) {
        return;
    }

    // Serialize all DB work under mutex
    await meta.mutex.runExclusive(async () => {
        if (meta.pendingUpdates.length === 0) {
            // Even if no pending binary updates, run projections if we have the document
            if (doc) {
                await runProjectionsInternal(docId, doc, "flush");
            }
            return;
        }

        console.log(`[Flush] Flushing ${meta.pendingUpdates.length} updates for ${docId}`);

        // Merge pending updates into a single blob
        const merged = mergePendingUpdates(meta);

        if (merged === null) {
            return;
        }

        try {
            await persistMergedUpdate(docId, merged);
            // Only clear pending after successful write to prevent data loss
            meta.pendingUpdates = [];
            meta.updatesSinceLastCompaction += 1;
            console.log(`[Flush] Successfully flushed update for ${docId} (${merged.byteLength} bytes)`);

            // Run flush-triggered projections
            if (doc) {
                await runProjectionsInternal(docId, doc, "flush");
            }
        } catch (error) {
            logPersistenceError('Flush', docId, error);
        }
    });
}

/**
 * Schedules a debounced flush of pending updates for a document.
 * 
 * This function implements a debouncing pattern to batch multiple rapid
 * updates into a single database write, improving performance.
 * 
 * @param docId - The unique identifier for the document
 * @param doc - The Yjs document containing updates to flush
 */
export function scheduleFlush(docId: string, doc: Y.Doc): void {
    const meta = getOrCreateMeta(docId, doc);

    console.log(`[Schedule] Scheduling flush for ${docId}, pending: ${meta.pendingUpdates.length}`);

    if (meta.flushTimer) {
        clearTimeout(meta.flushTimer);
    }
    meta.flushTimer = setTimeout(() => {
        meta.flushTimer = null;
        void flushPendingUpdates(docId, doc);
    }, DEBOUNCE_DELAY_MS);
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

    meta.compactionTimer = setInterval(() => {
        void compactDocument(docId, doc);
    }, COMPACTION_INTERVAL_MS);
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

    // Clean up projection manager resources
    projectionManager.cleanup(docId);

    // Clean up metadata
    documentMetadataMap.delete(docId);
}

/**
 * Compacts a document by creating a snapshot and clearing incremental updates.
 * Also creates automatic version snapshots periodically.
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

    // Serialize compaction under mutex
    await meta!.mutex.runExclusive(async () => {
        const snapshot = Y.encodeStateAsUpdate(doc);
        const snapshotBuffer = Buffer.from(snapshot);
        const currentTimestamp = BigInt(Date.now());

        try {
            console.log(`[Compaction] Executing transaction for ${docId}`);

            // Transaction: Save Snapshot + Delete Updates
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
            ]);

            // Run compact-triggered projections
            await runProjectionsInternal(docId, doc, "compact");

            if (meta) {
                meta.updatesSinceLastCompaction = 0;
            }

            // Auto-versioning: Create a version snapshot periodically
            if (meta) {
                const now = Date.now();
                const timeSinceLastVersion = now - meta.lastVersionCreatedAt;
                
                if (timeSinceLastVersion >= AUTO_VERSION_INTERVAL_MS) {
                    try {
                        await prisma.documentVersion.create({
                            data: {
                                documentId: docId,
                                snapshot: snapshotBuffer,
                                label: "Auto-save",
                                createdAt: currentTimestamp,
                            },
                        });
                        meta.lastVersionCreatedAt = now;
                        console.log(`[Versioning] Auto-created version for ${docId}`);
                        
                        // Enforce version limit (keep max 50)
                        await enforceVersionLimit(docId);
                    } catch (versionError) {
                        console.error(`[Versioning] Failed to create auto-version for ${docId}:`, versionError);
                    }
                }
            }

            console.log(`[Compaction] Success: ${docId}`);
        } catch (error) {
            logPersistenceError('Compaction', docId, error);
        }
    });
}

/**
 * Enforces the maximum version limit by deleting the oldest versions.
 * 
 * @param docId - The document identifier
 */
async function enforceVersionLimit(docId: string): Promise<void> {
    const MAX_VERSIONS = 50;
    
    const count = await prisma.documentVersion.count({
        where: { documentId: docId },
    });

    if (count <= MAX_VERSIONS) {
        return;
    }

    // Find the oldest versions to delete
    const versionsToDelete = await prisma.documentVersion.findMany({
        where: { documentId: docId },
        orderBy: { createdAt: 'asc' },
        take: count - MAX_VERSIONS,
        select: { id: true },
    });

    // Delete the oldest versions
    await prisma.documentVersion.deleteMany({
        where: {
            id: { in: versionsToDelete.map((v) => v.id) },
        },
    });

    console.log(`[Versioning] Pruned ${versionsToDelete.length} old versions for ${docId}`);
}


// ---- Public API ----

/**
 * Attaches the persistence layer to a Yjs document.
 * This is the centralized place where the update listener is bound.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to attach persistence to
 */
export function attachDocument(docId: string, doc: Y.Doc): void {
    const meta = getOrCreateMeta(docId, doc);

    // Prevent duplicate listener attachment
    if (meta.listenerAttached) {
        console.log(`[Persistence] Listener already attached for ${docId}, skipping`);
        return;
    }

    meta.listenerAttached = true;
    console.log(`[Persistence] Attaching update listener for ${docId}`);

    // Single update listener for this document
    doc.on("update", (update: Uint8Array, origin: unknown) => {
        if (origin === YJS_ORIGIN_PERSISTENCE) return;

        console.log(`[Update] Captured for ${docId}, size: ${update.byteLength}`);

        meta.pendingUpdates.push(update);
        projectionManager.markAllDirty(docId);
        scheduleFlush(docId, doc);
    });

    // Bind projection observers
    projectionManager.bindDocument(docId, doc);
}

/**
 * Saves and compacts a document.
 * Called when a document is closed or the server is shutting down.
 * 
 * @param docId - The document identifier
 * @param doc - The Yjs document to save
 */
export async function saveAndCompact(docId: string, doc: Y.Doc): Promise<void> {
    console.log(`[SaveAndCompact] Saving document on close: ${docId}`);

    // Flush any pending updates
    await flushPendingUpdates(docId, doc);

    // Force compaction regardless of updateRowsSinceCompact
    const meta = documentMetadataMap.get(docId);
    if (meta) {
        // Temporarily set to 1 to force compaction if needed
        const hadUpdates = meta.updatesSinceLastCompaction;
        meta.updatesSinceLastCompaction = 1;
        await compactDocument(docId, doc);

        // Run close-triggered projections
        await meta.mutex.runExclusive(async () => {
            await runProjectionsInternal(docId, doc, "close");
        });

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
        // Pass the tracked document object to ensure projections run
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

// Re-export projection manager for registration of additional projections
export { projectionManager };
