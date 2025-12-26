// persistence/projections/cia-projection.ts
/**
 * CIA Projection Plugin.
 * 
 * Syncs Confidentiality, Integrity, Availability values from the Yjs document
 * to the documents table in the relational database.
 * 
 * @module persistence/projections/cia-projection
 */

import type { Projection, ProjectionBindContext, ProjectionContext, PrismaClientType } from "./types";

// ---- CIA Level Mappings ----

/**
 * CIA level enumeration for internal calculations.
 */
enum CiaLevel {
    NotSet = 0,
    Low = 1,
    Medium = 2,
    High = 3,
}

/**
 * Maps a CIA string value to its numeric level.
 * 
 * @param value - The CIA level string ('Low', 'Medium', 'High', 'Critical')
 * @returns The numeric level (0-3), where 0 means not set
 */
function parseCiaLevel(value: string | undefined): CiaLevel {
    switch (value) {
        case 'Low':
            return CiaLevel.Low;
        case 'Medium':
            return CiaLevel.Medium;
        case 'High':
            return CiaLevel.High;
        case 'Critical':
            return CiaLevel.High; // Map Critical to High (3)
        default:
            return CiaLevel.NotSet;
    }
}

// ---- CIA Projection Implementation ----

/**
 * CIA Projection: Syncs CIA dropdown values to the documents table.
 * 
 * - Runs on "flush" trigger (frequent, lightweight)
 * - Uses fine-grained observer on the CIA map
 * - Idempotent upsert of CIA columns
 */
export const ciaProjection: Projection = {
    name: "cia",
    version: 1,
    triggers: ["flush", "compact", "close"],

    /**
     * Bind an observer to the CIA map to enable dirty tracking.
     */
    bind(ctx: ProjectionBindContext): void {
        const ciaMap = ctx.doc.getMap("cia");

        // Observe changes to the CIA map
        const observer = () => {
            ctx.markDirty();
        };

        ciaMap.observe(observer);

        console.log(`[CIAProjection] Bound observer to doc ${ctx.docId}`);
    },

    /**
     * Always run if called (dirty tracking handled by manager).
     */
    shouldRun(_ctx: ProjectionContext): boolean {
        return true;
    },

    /**
     * Apply CIA values to the documents table.
     */
    async apply(prisma: PrismaClientType, ctx: ProjectionContext): Promise<void> {
        const ciaMap = ctx.doc.getMap("cia");
        const rawCia = ciaMap.toJSON() as Record<string, string | undefined>;

        const confidentiality = parseCiaLevel(rawCia.confidentiality);
        const integrity = parseCiaLevel(rawCia.integrity);
        const availability = parseCiaLevel(rawCia.availability);

        await prisma.document.update({
            where: { id: ctx.docId },
            data: {
                confidentiality,
                integrity,
                availability,
            },
        });

        console.log(
            `[CIAProjection] Updated ${ctx.docId}: C=${confidentiality} I=${integrity} A=${availability}`
        );
    },
};
