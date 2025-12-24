/**
 * SyncedStore configuration for Yjs-based collaborative editing.
 * 
 * This module defines the store shape used throughout the application
 * for managing CIA (Confidentiality, Integrity, Availability) values,
 * security controls, and ProseMirror document content.
 * 
 * @module store
 */

import { syncedStore, getYjsDoc } from "@syncedstore/core";

/**
 * Shape of the application store.
 * 
 * - cia: Stores CIA triad values (confidentiality, integrity, availability)
 * - controls: Maps security control IDs to their enabled status
 * - prosemirror: Stores the ProseMirror document as XML
 */
export interface StoreShape {
    /** CIA triad values for risk assessment. */
    cia: {
        confidentiality?: string;
        integrity?: string;
        availability?: string;
    };
    
    /** Security control states mapped by control ID. */
    controls: Record<string, boolean>;
    
    /** ProseMirror document content stored as XML. */
    prosemirror: any;
}

/**
 * Creates a new SyncedStore instance with the default store shape.
 * 
 * @returns A new SyncedStore instance configured for the application
 */
export function createStore(): StoreShape {
    return syncedStore({
        cia: {},
        controls: {},
        prosemirror: "xml",
    }) as StoreShape;
}

/**
 * Extracts the underlying Yjs document from a SyncedStore instance.
 * 
 * @param store - The SyncedStore instance
 * @returns The underlying Yjs document
 */
export { getYjsDoc };
