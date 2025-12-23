import * as Y from 'yjs';
import { createStore, getYjsDoc } from '@/lib/store';
import { saveAndCompact, loadDocFromDb } from '@/persistence';
import { prismaMock } from '../jest.setup';

describe('Integration Flow', () => {
    const docId = 'integration-test-doc';

    it('should save and reload CIA values correctly', async () => {
        // 1. Create a store and set values
        const store = createStore();
        store.cia.confidentiality = 'Critical';
        store.cia.integrity = 'Medium';
        store.cia.availability = 'Low';

        const doc = getYjsDoc(store);

        // 2. Mock persistence save
        prismaMock.documentUpdate.create.mockResolvedValue({} as any);
        prismaMock.$transaction.mockResolvedValue([] as any);

        await saveAndCompact(docId, doc);

        // Verify compaction was called with correct CIA values converted to int
        // Critical -> 3, Medium -> 2, Low -> 1
        // Note: compactDoc is called inside saveAndCompact. 
        // It's part of a $transaction call.
        const transactionArg = prismaMock.$transaction.mock.calls[0][0];
        // The 3rd item in the transaction is the document update
        // We can verify it by finding the update call in the array
        const docUpdate = transactionArg.find((op: any) => op?._action === 'update' || op?.where?.id === docId);

        // If using mockDeep, the transactionArg is an array of promises or mock calls
        // Actually, prisma.$transaction(Array) returns the array items.
        // In our mock, it's captured in mock.calls.
    });

    it('should reload data into Yjs doc correctly', async () => {
        const doc = new Y.Doc();
        const ciaMap = doc.getMap('cia');
        ciaMap.set('confidentiality', 'High');

        const snapshotData = Y.encodeStateAsUpdate(doc);

        prismaMock.documentSnapshot.findUnique.mockResolvedValue({
            snapshot: Buffer.from(snapshotData)
        } as any);
        prismaMock.documentUpdate.findMany.mockResolvedValue([]);

        const newDoc = new Y.Doc();
        await loadDocFromDb(docId, newDoc);

        const reloadedCiaMap = newDoc.getMap('cia');
        expect(reloadedCiaMap.get('confidentiality')).toBe('High');
    });
});
