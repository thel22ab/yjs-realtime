// persistence/projections/index.ts
/**
 * Projection plugin system barrel export.
 * 
 * @module persistence/projections
 */

// Types
export type {
    Projection,
    ProjectionContext,
    ProjectionBindContext,
    ProjectionTrigger,
    ProjectionStateRecord,
    PrismaClientType,
} from "./types";

// Manager
export { ProjectionManager, projectionManager } from "./ProjectionManager";

// Projections
export { ciaProjection } from "./cia-projection";
