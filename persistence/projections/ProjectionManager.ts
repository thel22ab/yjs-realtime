// persistence/projections/ProjectionManager.ts
/**
 * ProjectionManager orchestrates projection plugins per document.
 * 
 * Responsibilities:
 * - Register projections
 * - Bind projection observers to documents
 * - Track dirty flags per document/projection
 * - Run projections based on triggers
 * - Update ProjectionState in database
 * 
 * @module persistence/projections/ProjectionManager
 */

import type * as Y from "yjs";
import type { Projection, ProjectionContext, ProjectionTrigger, PrismaClientType } from "./types";

/**
 * Orchestrates projection plugins for Yjs documents.
 */
export class ProjectionManager {
    /** Registered projections */
    private projections: Projection[] = [];

    /** Dirty flags per document: docId -> Set of dirty projection names */
    private dirtyFlags = new Map<string, Set<string>>();

    /** Unbind functions per document: docId -> cleanup functions */
    private unbindFunctions = new Map<string, (() => void)[]>();

    /**
     * Register a projection plugin.
     * 
     * @param projection - The projection to register
     */
    register(projection: Projection): void {
        // Prevent duplicate registration
        if (this.projections.find(p => p.name === projection.name)) {
            console.warn(`[ProjectionManager] Projection "${projection.name}" already registered, skipping`);
            return;
        }
        this.projections.push(projection);
        console.log(`[ProjectionManager] Registered projection: ${projection.name} v${projection.version}`);
    }

    /**
     * Get all registered projections.
     */
    getProjections(): ReadonlyArray<Projection> {
        return this.projections;
    }

    /**
     * Bind all projection observers to a document.
     * Called once when a document is attached to persistence.
     * 
     * @param docId - The document identifier
     * @param doc - The Yjs document
     */
    bindDocument(docId: string, doc: Y.Doc): void {
        // Initialize dirty flags for this document
        if (!this.dirtyFlags.has(docId)) {
            this.dirtyFlags.set(docId, new Set());
        }

        const unbinders: (() => void)[] = [];

        for (const projection of this.projections) {
            if (projection.bind) {
                const markDirty = () => this.markDirty(docId, projection.name);
                projection.bind({ docId, doc, markDirty });
                console.log(`[ProjectionManager] Bound projection "${projection.name}" to doc ${docId}`);
            }
        }

        this.unbindFunctions.set(docId, unbinders);
    }

    /**
     * Mark a specific projection as dirty for a document.
     * 
     * @param docId - The document identifier
     * @param projectionName - The name of the dirty projection
     */
    markDirty(docId: string, projectionName: string): void {
        let flags = this.dirtyFlags.get(docId);
        if (!flags) {
            flags = new Set();
            this.dirtyFlags.set(docId, flags);
        }
        flags.add(projectionName);
    }

    /**
     * Mark all projections as dirty for a document.
     * Called on every Yjs update if projections don't have fine-grained observers.
     * 
     * @param docId - The document identifier
     */
    markAllDirty(docId: string): void {
        let flags = this.dirtyFlags.get(docId);
        if (!flags) {
            flags = new Set();
            this.dirtyFlags.set(docId, flags);
        }
        for (const projection of this.projections) {
            flags.add(projection.name);
        }
    }

    /**
     * Check if a projection is dirty for a document.
     * 
     * @param docId - The document identifier
     * @param projectionName - The projection name
     */
    isDirty(docId: string, projectionName: string): boolean {
        const flags = this.dirtyFlags.get(docId);
        return flags?.has(projectionName) ?? false;
    }

    /**
     * Clear dirty flag for a projection.
     * 
     * @param docId - The document identifier
     * @param projectionName - The projection name
     */
    private clearDirty(docId: string, projectionName: string): void {
        this.dirtyFlags.get(docId)?.delete(projectionName);
    }

    /**
     * Run projections that match the given trigger.
     * 
     * For "flush" trigger: Only run dirty projections.
     * For "compact"/"close" trigger: Run all projections (heavier, less frequent).
     * 
     * @param docId - The document identifier
     * @param doc - The Yjs document
     * @param trigger - The trigger event
     * @param prisma - Prisma client for database operations
     */
    async runProjections(
        docId: string,
        doc: Y.Doc,
        trigger: ProjectionTrigger,
        prisma: PrismaClientType
    ): Promise<void> {
        const now = BigInt(Date.now());
        const context: ProjectionContext = { docId, doc, now, trigger };

        for (const projection of this.projections) {
            // Check if projection responds to this trigger
            if (!projection.triggers.includes(trigger)) {
                continue;
            }

            // For flush, only run if dirty
            if (trigger === "flush" && !this.isDirty(docId, projection.name)) {
                continue;
            }

            try {
                // Check if projection wants to run
                const shouldRun = await projection.shouldRun(context);
                if (!shouldRun) {
                    continue;
                }

                console.log(`[Projection][${projection.name}] Running for ${docId} (trigger: ${trigger})`);

                // Run the projection
                await projection.apply(prisma, context);

                // Update projection state
                await this.updateProjectionState(prisma, docId, projection, now, null);

                // Clear dirty flag
                this.clearDirty(docId, projection.name);

                console.log(`[Projection][${projection.name}] Completed for ${docId}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                console.error(`[Projection][${projection.name}] Failed for ${docId}:`, error);

                // Record error in projection state
                await this.updateProjectionState(prisma, docId, projection, now, errorMessage);
            }
        }
    }

    /**
     * Update the ProjectionState record in the database.
     */
    private async updateProjectionState(
        prisma: PrismaClientType,
        docId: string,
        projection: Projection,
        now: bigint,
        error: string | null
    ): Promise<void> {
        try {
            await prisma.projectionState.upsert({
                where: {
                    docId_name: { docId, name: projection.name },
                },
                update: {
                    version: projection.version,
                    lastAppliedRev: now,
                    lastAppliedAt: now,
                    lastError: error,
                },
                create: {
                    docId,
                    name: projection.name,
                    version: projection.version,
                    lastAppliedRev: now,
                    lastAppliedAt: now,
                    lastError: error,
                },
            });
        } catch (stateError) {
            // Don't fail the projection if state update fails
            console.error(`[ProjectionManager] Failed to update state for ${projection.name}:`, stateError);
        }
    }

    /**
     * Clean up resources for a document.
     * Called when a document is closed.
     * 
     * @param docId - The document identifier
     */
    cleanup(docId: string): void {
        // Run unbind functions
        const unbinders = this.unbindFunctions.get(docId);
        if (unbinders) {
            for (const unbind of unbinders) {
                unbind();
            }
        }

        // Clear state
        this.dirtyFlags.delete(docId);
        this.unbindFunctions.delete(docId);
        console.log(`[ProjectionManager] Cleaned up doc ${docId}`);
    }
}

/**
 * Singleton instance for the application.
 */
export const projectionManager = new ProjectionManager();
