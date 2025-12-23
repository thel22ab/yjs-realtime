import { getDocuments, getDocument, deleteDocument } from '@/app/actions/documents';
import { prismaMock } from '../jest.setup';

describe('Document Actions', () => {
    it('should get all documents', async () => {
        const mockDocs = [
            { id: '1', title: 'Doc 1', confidentiality: 1, integrity: 1, availability: 1, createdAt: new Date() },
            { id: '2', title: 'Doc 2', confidentiality: 2, integrity: 2, availability: 2, createdAt: new Date() },
        ];

        prismaMock.document.findMany.mockResolvedValue(mockDocs as any);

        const docs = await getDocuments();
        expect(docs).toHaveLength(2);
        expect(docs[0].title).toBe('Doc 1');
        expect(prismaMock.document.findMany).toHaveBeenCalled();
    });

    it('should get a single document', async () => {
        const mockDoc = { id: '1', title: 'Doc 1', confidentiality: 1, integrity: 1, availability: 1, createdAt: new Date() };
        prismaMock.document.findUnique.mockResolvedValue(mockDoc as any);

        const doc = await getDocument('1');
        expect(doc?.title).toBe('Doc 1');
        expect(prismaMock.document.findUnique).toHaveBeenCalledWith({
            where: { id: '1' },
        });
    });

    it('should return undefined for missing document', async () => {
        prismaMock.document.findUnique.mockResolvedValue(null);

        const doc = await getDocument('999');
        expect(doc).toBeUndefined();
    });

    it('should delete a document', async () => {
        prismaMock.document.delete.mockResolvedValue({ id: '1' } as any);

        const result = await deleteDocument('1');
        expect(result.success).toBe(true);
        expect(prismaMock.document.delete).toHaveBeenCalledWith({
            where: { id: '1' },
        });
    });

    it('should handle deletion error', async () => {
        prismaMock.document.delete.mockRejectedValue(new Error('DB Error'));

        const result = await deleteDocument('1');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Failed to delete document');
    });
});
