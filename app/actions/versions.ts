/**
 * Server actions for document version management.
 * 
 * This module provides server-side actions for creating, listing,
 * and managing document version history.
 * 
 * @module versionActions
 */

'use server';

import db from '@/lib/db';
import * as Y from 'yjs';

// ---- Configuration ----

/** Maximum number of versions to retain per document. */
const MAX_VERSIONS_PER_DOCUMENT = 50;

// ---- Types ----

/**
 * Summary of a version for list views.
 */
export interface VersionListItem {
    id: number;
    label: string | null;
    createdAt: string;
}

/**
 * Full version details including snapshot.
 */
export interface VersionDetails {
    id: number;
    documentId: string;
    label: string | null;
    snapshot: Uint8Array;
    createdAt: string;
}

/**
 * Result type for version operations.
 */
export type VersionResult<T> =
    | { success: true; data: T }
    | { success: false; error: string };

// ---- Actions ----

/**
 * Creates a new version snapshot for a document.
 * 
 * @param documentId - The document identifier
 * @param snapshot - The encoded Yjs document state
 * @param label - Optional label for the version
 * @returns Result with the new version ID
 */
export async function createVersion(
    documentId: string,
    snapshot: Uint8Array,
    label?: string
): Promise<VersionResult<{ id: number }>> {
    try {
        // Verify document exists
        const document = await db.document.findUnique({
            where: { id: documentId },
        });

        if (!document) {
            return { success: false, error: 'Document not found' };
        }

        // Create the new version
        const version = await db.documentVersion.create({
            data: {
                documentId,
                snapshot: Buffer.from(snapshot),
                label: label || null,
                createdAt: BigInt(Date.now()),
            },
        });

        // Enforce version limit - delete oldest versions if over limit
        await enforceVersionLimit(documentId);

        return { success: true, data: { id: version.id } };
    } catch (error) {
        console.error('Failed to create version:', error);
        return { success: false, error: 'Failed to create version' };
    }
}

/**
 * Creates a version from a Y.Doc object.
 * This is a convenience method for creating versions from live documents.
 * 
 * @param documentId - The document identifier
 * @param doc - The Yjs document
 * @param label - Optional label for the version
 * @returns Result with the new version ID
 */
export async function createVersionFromDoc(
    documentId: string,
    doc: Y.Doc,
    label?: string
): Promise<VersionResult<{ id: number }>> {
    const snapshot = Y.encodeStateAsUpdate(doc);
    return createVersion(documentId, snapshot, label);
}

/**
 * Retrieves all versions for a document, ordered by creation date (newest first).
 * 
 * @param documentId - The document identifier
 * @returns Array of version summaries
 */
export async function getVersions(documentId: string): Promise<VersionListItem[]> {
    try {
        const versions = await db.documentVersion.findMany({
            where: { documentId },
            orderBy: { createdAt: 'desc' },
            take: MAX_VERSIONS_PER_DOCUMENT,
            select: {
                id: true,
                label: true,
                createdAt: true,
            },
        });

        return versions.map((v) => ({
            id: v.id,
            label: v.label,
            createdAt: new Date(Number(v.createdAt)).toISOString(),
        }));
    } catch (error) {
        console.error('Failed to fetch versions:', error);
        return [];
    }
}

/**
 * Retrieves a single version by its ID.
 * 
 * @param versionId - The version identifier
 * @returns The version details, or undefined if not found
 */
export async function getVersion(versionId: number): Promise<VersionDetails | undefined> {
    try {
        const version = await db.documentVersion.findUnique({
            where: { id: versionId },
        });

        if (!version) {
            return undefined;
        }

        return {
            id: version.id,
            documentId: version.documentId,
            label: version.label,
            snapshot: new Uint8Array(version.snapshot),
            createdAt: new Date(Number(version.createdAt)).toISOString(),
        };
    } catch (error) {
        console.error('Failed to fetch version:', error);
        return undefined;
    }
}

/**
 * Deletes a specific version.
 * 
 * @param versionId - The version identifier
 * @returns Result indicating success or failure
 */
export async function deleteVersion(versionId: number): Promise<VersionResult<void>> {
    try {
        await db.documentVersion.delete({
            where: { id: versionId },
        });
        return { success: true, data: undefined };
    } catch (error) {
        console.error('Failed to delete version:', error);
        return { success: false, error: 'Failed to delete version' };
    }
}

/**
 * Counts the total number of versions for a document.
 * 
 * @param documentId - The document identifier
 * @returns The version count
 */
export async function getVersionCount(documentId: string): Promise<number> {
    try {
        return await db.documentVersion.count({
            where: { documentId },
        });
    } catch (error) {
        console.error('Failed to count versions:', error);
        return 0;
    }
}

// ---- Internal Functions ----

/**
 * Enforces the maximum version limit by deleting the oldest versions.
 * 
 * @param documentId - The document identifier
 */
async function enforceVersionLimit(documentId: string): Promise<void> {
    const count = await db.documentVersion.count({
        where: { documentId },
    });

    if (count <= MAX_VERSIONS_PER_DOCUMENT) {
        return;
    }

    // Find the oldest versions to delete
    const versionsToDelete = await db.documentVersion.findMany({
        where: { documentId },
        orderBy: { createdAt: 'asc' },
        take: count - MAX_VERSIONS_PER_DOCUMENT,
        select: { id: true },
    });

    // Delete the oldest versions
    await db.documentVersion.deleteMany({
        where: {
            id: { in: versionsToDelete.map((v) => v.id) },
        },
    });

    console.log(`[Versions] Pruned ${versionsToDelete.length} old versions for ${documentId}`);
}
