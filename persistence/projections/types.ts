// persistence/projections/types.ts
/**
 * Core types and interfaces for the projection plugin system.
 * 
 * Projections are isolated, idempotent units that transform Yjs document
 * state into relational database rows (e.g., CIA values, controls, search text).
 * 
 * @module persistence/projections/types
 */

import type * as Y from "yjs";
import type prisma from "../../lib/db";

// Use typeof to get the exact Prisma client type from our singleton
export type PrismaClientType = typeof prisma;

// ---- Trigger Types ----

/**
 * Events that can trigger a projection to run.
 * 
 * - `flush`: Frequent, debounced (every ~50ms during edits). Best for light ops.
 * - `compact`: Periodic (every ~10s). Best for heavier aggregations.
 * - `close`: When last client disconnects. Final cleanup.
 */
export type ProjectionTrigger = "flush" | "compact" | "close";

// ---- Context Types ----

/**
 * Context passed to projections when they run.
 */
export interface ProjectionContext {
    /** The document identifier */
    docId: string;

    /** The Yjs document */
    doc: Y.Doc;

    /** Current timestamp in milliseconds (as BigInt for Prisma) */
    now: bigint;

    /** The trigger that caused this projection to run */
    trigger: ProjectionTrigger;
}

/**
 * Context passed to projections during document binding.
 */
export interface ProjectionBindContext {
    /** The document identifier */
    docId: string;

    /** The Yjs document */
    doc: Y.Doc;

    /** Call this to mark this projection as dirty (needs to run) */
    markDirty: () => void;
}

// ---- Projection Interface ----

/**
 * A projection plugin that syncs Yjs document state to relational tables.
 * 
 * Projections must be:
 * - **Idempotent**: Running multiple times produces the same result
 * - **Versioned**: Track schema/logic changes for safe upgrades
 * - **Trigger-aware**: Know which triggers they should respond to
 * 
 * @example
 * ```typescript
 * const ciaProjection: Projection = {
 *     name: "cia",
 *     version: 1,
 *     triggers: ["flush"],
 *     
 *     bind({ doc, markDirty }) {
 *         doc.getMap("cia").observe(() => markDirty());
 *     },
 *     
 *     shouldRun(ctx) {
 *         return true; // Dirty tracking handled by manager
 *     },
 *     
 *     async apply(prisma, ctx) {
 *         // Sync CIA values to documents table
 *     },
 * };
 * ```
 */
export interface Projection {
    /** Unique name for this projection (used in ProjectionState table) */
    name: string;

    /** Version number for tracking schema/logic changes */
    version: number;

    /** Which triggers should run this projection */
    triggers: ProjectionTrigger[];

    /**
     * Optional: Attach observers to the Yjs document to enable fine-grained
     * dirty tracking. Called once when a document is bound to persistence.
     * 
     * If not implemented, the projection will be marked dirty on every update.
     */
    bind?(ctx: ProjectionBindContext): void;

    /**
     * Determine whether this projection should run.
     * Called even if dirty; allows projections to skip based on state
     * (e.g., version comparison, hash check).
     * 
     * @returns true if the projection should run, false to skip
     */
    shouldRun(ctx: ProjectionContext): Promise<boolean> | boolean;

    /**
     * Apply changes to the database.
     * 
     * @param prisma - Prisma client instance
     * @param ctx - Projection context with docId, doc, timestamp, and trigger
     */
    apply(prisma: PrismaClientType, ctx: ProjectionContext): Promise<void>;
}

// ---- Projection State (mirrors Prisma model) ----

/**
 * State tracking for a projection on a specific document.
 * Used for version tracking, error recovery, and idempotency.
 */
export interface ProjectionStateRecord {
    docId: string;
    name: string;
    version: number;
    lastAppliedRev: bigint;
    lastAppliedAt: bigint;
    lastError: string | null;
}
