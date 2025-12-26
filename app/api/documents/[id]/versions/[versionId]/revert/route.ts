/**
 * API route for reverting a document to a specific version.
 * 
 * POST: Revert the document to the specified version.
 * This uses the "git revert" style approach where reverting changes
 * are applied as new updates, allowing all connected clients to sync.
 * 
 * @module api/documents/[id]/versions/[versionId]/revert
 */

import { NextRequest, NextResponse } from 'next/server';
import { getVersion } from '@/app/actions/versions';
import * as Y from 'yjs';

interface RouteParams {
    params: Promise<{ id: string; versionId: string }>;
}

/**
 * POST /api/documents/[id]/versions/[versionId]/revert
 * 
 * Reverts the document to the specified version.
 * The revert is applied as a new update so all connected clients sync automatically.
 */
export async function POST(
    _request: NextRequest,
    { params }: RouteParams
): Promise<NextResponse> {
    const { id: documentId, versionId: versionIdStr } = await params;
    const versionId = parseInt(versionIdStr, 10);

    if (isNaN(versionId)) {
        return NextResponse.json(
            { error: 'Invalid version ID' },
            { status: 400 }
        );
    }

    try {
        // 1. Load the target version from the database
        const version = await getVersion(versionId);

        if (!version) {
            return NextResponse.json(
                { error: 'Version not found' },
                { status: 404 }
            );
        }

        // Verify the version belongs to the correct document
        if (version.documentId !== documentId) {
            return NextResponse.json(
                { error: 'Version does not belong to this document' },
                { status: 403 }
            );
        }

        // 2. Get the current Y.Doc from memory
        const { docs } = await import('@y/websocket-server/utils');
        const currentDoc = docs.get(documentId);

        if (!currentDoc) {
            return NextResponse.json(
                { error: 'Document not currently loaded in memory. Open the document first.' },
                { status: 404 }
            );
        }

        // 3. Create a temporary doc and apply the version snapshot
        // The version.snapshot is already a full document state (encodeStateAsUpdate)
        const tempDoc = new Y.Doc();
        Y.applyUpdate(tempDoc, version.snapshot);

        // 4. Calculate the state we want to revert to
        // We need to create an update that, when applied to currentDoc,
        // will make it match tempDoc's state

        // Strategy: Clear relevant shared types and rebuild from version
        // For this app, we have: cia (Y.Map), controls (Y.Map), prosemirror (Y.XmlFragment)

        currentDoc.transact(() => {
            // Get shared types from both docs
            const currentCia = currentDoc.getMap('cia');
            const tempCia = tempDoc.getMap('cia');

            const currentControls = currentDoc.getMap('controls');
            const tempControls = tempDoc.getMap('controls');

            const currentProsemirror = currentDoc.getXmlFragment('prosemirror');
            const tempProsemirror = tempDoc.getXmlFragment('prosemirror');

            // Clear and restore CIA map
            currentCia.forEach((_value, key) => {
                currentCia.delete(key);
            });
            tempCia.forEach((value, key) => {
                currentCia.set(key, value);
            });

            // Clear and restore controls map
            currentControls.forEach((_value, key) => {
                currentControls.delete(key);
            });
            tempControls.forEach((value, key) => {
                currentControls.set(key, value);
            });

            // Clear and restore ProseMirror content
            // Delete all children from current
            while (currentProsemirror.length > 0) {
                currentProsemirror.delete(0, 1);
            }

            // Clone children from temp to current
            // Note: XmlFragment children are XmlElement or XmlText
            for (let i = 0; i < tempProsemirror.length; i++) {
                const child = tempProsemirror.get(i);
                if (child) {
                    // Clone the child - we need to create a deep copy
                    currentProsemirror.insert(i, [child.clone()]);
                }
            }
        }, 'revert');

        // 5. Clean up temp doc
        tempDoc.destroy();

        console.log(`[Revert] Document ${documentId} reverted to version ${versionId}`);

        return NextResponse.json({
            success: true,
            message: `Reverted to version from ${version.createdAt}`
        });
    } catch (error) {
        console.error('Failed to revert to version:', error);
        return NextResponse.json(
            { error: 'Failed to revert to version' },
            { status: 500 }
        );
    }
}
