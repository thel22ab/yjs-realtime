/**
 * Unit tests for document server actions.
 * Tests CRUD operations for risk assessment documents.
 */

import { getDocuments, getDocument, deleteDocument } from '@/app/actions/documents';
import { prismaMock } from '../jest.setup';

describe('Document Actions', () => {
    describe('getDocuments', () => {
        it('returns a list of all documents ordered by creation date', async () => {
            const mockDocuments = [
                { 
                    id: '1', 
                    title: 'Doc 1', 
                    confidentiality: 1, 
                    integrity: 1, 
                    availability: 1, 
                    createdAt: new Date() 
                },
                { 
                    id: '2', 
                    title: 'Doc 2', 
                    confidentiality: 2, 
                    integrity: 2, 
                    availability: 2, 
                    createdAt: new Date() 
                },
            ];

            prismaMock.document.findMany.mockResolvedValue(mockDocuments as any);

            const documents = await getDocuments();

            expect(documents).toHaveLength(2);
            expect(documents[0].title).toBe('Doc 1');
            expect(prismaMock.document.findMany).toHaveBeenCalledWith({
                orderBy: { createdAt: 'desc' },
            });
        });

        it('returns an empty array when no documents exist', async () => {
            prismaMock.document.findMany.mockResolvedValue([]);

            const documents = await getDocuments();

            expect(documents).toEqual([]);
        });

        it('returns an empty array on database error', async () => {
            prismaMock.document.findMany.mockRejectedValue(new Error('Database error'));

            const documents = await getDocuments();

            expect(documents).toEqual([]);
        });
    });

    describe('getDocument', () => {
        it('returns document details when document exists', async () => {
            const mockDocument = { 
                id: '1', 
                title: 'Test Document', 
                confidentiality: 2, 
                integrity: 3, 
                availability: 1, 
                createdAt: new Date() 
            };

            prismaMock.document.findUnique.mockResolvedValue(mockDocument as any);

            const document = await getDocument('1');

            expect(document?.title).toBe('Test Document');
            expect(document?.confidentiality).toBe(2);
            expect(prismaMock.document.findUnique).toHaveBeenCalledWith({
                where: { id: '1' },
            });
        });

        it('returns undefined when document does not exist', async () => {
            prismaMock.document.findUnique.mockResolvedValue(null);

            const document = await getDocument('999');

            expect(document).toBeUndefined();
        });

        it('returns undefined on database error', async () => {
            prismaMock.document.findUnique.mockRejectedValue(new Error('Database error'));

            const document = await getDocument('1');

            expect(document).toBeUndefined();
        });
    });

    describe('deleteDocument', () => {
        it('returns success when document is deleted', async () => {
            prismaMock.document.delete.mockResolvedValue({ id: '1' } as any);

            const result = await deleteDocument('1');

            expect(result.success).toBe(true);
            expect(prismaMock.document.delete).toHaveBeenCalledWith({
                where: { id: '1' },
            });
        });

        it('returns error message when deletion fails', async () => {
            prismaMock.document.delete.mockRejectedValue(new Error('DB Error'));

            const result = await deleteDocument('1');

            expect(result.success).toBe(false);
            // Type guard for accessing error property
            if ('error' in result) {
                expect(result.error).toBe('Failed to delete document');
            }
        });
    });
});
