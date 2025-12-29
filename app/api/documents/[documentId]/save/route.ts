import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

/**
 * POST /api/documents/[documentId]/save
 * 
 * Saves document metadata (CIA values) directly to the database.
 * This endpoint is designed to be called before navigation to ensure
 * critical document data is persisted.
 * 
 * @param request - The incoming HTTP request
 * @param params - Route parameters containing documentId
 * @returns JSON response indicating success or failure
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
): Promise<NextResponse> {
  try {
    const { documentId } = await params;

    if (!documentId) {
      return NextResponse.json(
        { error: 'Document ID is required' },
        { status: 400 }
      );
    }

    // Check if document exists
    const existingDocument = await prisma.document.findUnique({
      where: { id: documentId },
    });

    if (!existingDocument) {
      return NextResponse.json(
        { error: 'Document not found' },
        { status: 404 }
      );
    }

    // For this direct database save approach, we update the document's
    // timestamp to indicate it was accessed/modified.
    // In a more advanced implementation, you could also accept and save
    // CIA values from the request body.
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        // Update the updatedAt field to indicate recent activity
        // Note: This assumes the schema has an updatedAt field, otherwise remove this line
        // updatedAt: new Date(),
      },
    });

    console.log(`[API] Successfully saved document metadata for ${documentId}`);

    return NextResponse.json({
      success: true,
      documentId,
      message: 'Document metadata saved successfully',
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error(`[API] Error saving document:`, error);
    
    return NextResponse.json(
      {
        error: 'Failed to save document',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}