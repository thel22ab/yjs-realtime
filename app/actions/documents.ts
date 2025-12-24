/**
 * Server actions for document management.
 * 
 * This module provides server-side actions for creating, reading,
 * updating, and deleting risk assessment documents.
 * 
 * @module documentActions
 */

'use server';

import { redirect } from 'next/navigation';
import db from '@/lib/db';
import { randomUUID } from 'crypto';

// ---- Types ----

/**
 * Summary of a document for list views.
 */
export interface DocumentListItem {
    id: string;
    title: string;
    confidentiality: number;
    integrity: number;
    availability: number;
    createdAt: string;
}

/**
 * Full document details including all fields.
 */
export interface DocumentDetails {
    id: string;
    title: string;
    confidentiality: number;
    integrity: number;
    availability: number;
    createdAt: string;
    updatedAt: string | null;
}

/**
 * Result type for delete operations.
 */
type DeleteResult = 
    | { success: true }
    | { success: false; error: string };

// ---- Actions ----

/**
 * Creates a new document with the given title.
 * 
 * @param formData - Form data containing the document title
 * @returns Redirects to the document page on success
 * @throws Error if title is missing or creation fails
 */
export async function createDocument(formData: FormData): Promise<void> {
    const title = formData.get('title') as string;
    
    if (!title || title.trim().length === 0) {
        throw new Error('Title is required');
    }

    const id = randomUUID();
    
    try {
        await db.document.create({
            data: {
                id,
                title: title.trim(),
            },
        });
    } catch (error) {
        console.error('Failed to create document:', error);
        throw new Error('Failed to create document');
    }

    redirect(`/document/${id}`);
}

/**
 * Retrieves all documents ordered by creation date (newest first).
 * 
 * @returns Array of document summaries
 */
export async function getDocuments(): Promise<DocumentListItem[]> {
    try {
        const documents = await db.document.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });

        return documents.map((doc) => ({
            id: doc.id,
            title: doc.title,
            confidentiality: doc.confidentiality,
            integrity: doc.integrity,
            availability: doc.availability,
            createdAt: doc.createdAt.toISOString(),
        }));
    } catch (error) {
        console.error('Failed to fetch documents:', error);
        return [];
    }
}

/**
 * Retrieves a single document by its ID.
 * 
 * @param id - The document identifier
 * @returns The document details, or undefined if not found
 */
export async function getDocument(id: string): Promise<DocumentDetails | undefined> {
    try {
        const document = await db.document.findUnique({
            where: { id },
        });

        if (!document) {
            return undefined;
        }

        return {
            id: document.id,
            title: document.title,
            confidentiality: document.confidentiality,
            integrity: document.integrity,
            availability: document.availability,
            createdAt: document.createdAt.toISOString(),
            updatedAt: null, // Field may not exist in current schema
        };
    } catch (error) {
        console.error('Failed to fetch document:', error);
        return undefined;
    }
}

/**
 * Deletes a document by its ID.
 * Associated snapshots and updates are deleted via cascade.
 * 
 * @param id - The document identifier
 * @returns Result indicating success or failure with error message
 */
export async function deleteDocument(id: string): Promise<DeleteResult> {
    try {
        // Cascade delete will remove associated snapshots and updates
        await db.document.delete({
            where: { id },
        });
        
        return { success: true };
    } catch (error) {
        console.error('Failed to delete document:', error);
        return { success: false, error: 'Failed to delete document' };
    }
}
