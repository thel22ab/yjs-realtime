/**
 * API routes for document versions.
 * 
 * GET: List all versions for a document
 * POST: Create a new version snapshot
 * 
 * @module api/documents/[id]/versions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVersions, createVersion } from '@/app/actions/versions';

interface RouteParams {
    params: Promise<{ id: string }>;
}

/**
 * GET /api/documents/[id]/versions
 * Returns a list of all versions for the document.
 */
export async function GET(
    _request: NextRequest,
    { params }: RouteParams
): Promise<NextResponse> {
    const { id: documentId } = await params;

    try {
        const versions = await getVersions(documentId);
        return NextResponse.json({ versions });
    } catch (error) {
        console.error('Failed to fetch versions:', error);
        return NextResponse.json(
            { error: 'Failed to fetch versions' },
            { status: 500 }
        );
    }
}

/**
 * POST /api/documents/[id]/versions
 * Creates a new version snapshot.
 * 
 * Body: { label?: string }
 * Note: The snapshot is created from the current document state on the server.
 */
export async function POST(
    request: NextRequest,
    { params }: RouteParams
): Promise<NextResponse> {
    const { id: documentId } = await params;

    try {
        const body = await request.json().catch(() => ({}));
        const label = body.label as string | undefined;

        // Import docs map to get current Y.Doc state
        // This is a dynamic import to avoid circular dependencies
        const { docs } = await import('@y/websocket-server/utils');
        const doc = docs.get(documentId);

        if (!doc) {
            return NextResponse.json(
                { error: 'Document not currently loaded in memory. Open the document first.' },
                { status: 404 }
            );
        }

        // Get the current document state as a snapshot
        const Y = await import('yjs');
        const snapshot = Y.encodeStateAsUpdate(doc);

        const result = await createVersion(documentId, snapshot, label);

        if (!result.success) {
            return NextResponse.json(
                { error: result.error },
                { status: 400 }
            );
        }

        return NextResponse.json({
            success: true,
            versionId: result.data.id
        });
    } catch (error) {
        console.error('Failed to create version:', error);
        return NextResponse.json(
            { error: 'Failed to create version' },
            { status: 500 }
        );
    }
}
