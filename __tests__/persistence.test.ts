import * as Y from 'yjs';
import { getOrCreateMeta, scheduleFlush, stopCompactionTimer, saveAndCompact } from '@/persistence';
import { prismaMock } from '../jest.setup';

jest.useFakeTimers();

describe('Persistence Layer', () => {
    const docId = 'test-doc';
    let doc: Y.Doc;

    beforeEach(() => {
        doc = new Y.Doc();
        // Clear the internal docMeta map by resetting the module or just clearing it if possible
        // Since it's a module-level variable, we might need to be careful
    });

    it('should create and retrieve meta', () => {
        const meta = getOrCreateMeta(docId);
        expect(meta).toBeDefined();
        expect(meta.pending).toEqual([]);

        const sameMeta = getOrCreateMeta(docId);
        expect(sameMeta).toBe(meta);
    });

    it('should schedule a flush', async () => {
        const meta = getOrCreateMeta(docId);
        meta.pending = [new Uint8Array([1, 2, 3])];

        scheduleFlush(docId);

        expect(prismaMock.documentUpdate.create).not.toHaveBeenCalled();

        jest.runAllTimers();

        // flushPendingUpdates is async
        await Promise.resolve();

        expect(prismaMock.documentUpdate.create).toHaveBeenCalled();
        expect(meta.pending).toEqual([]);
    });

    it('should stop timers correctly', () => {
        const meta = getOrCreateMeta(docId);
        meta.flushTimer = setTimeout(() => { }, 100);
        meta.compactTimer = setInterval(() => { }, 100);

        stopCompactionTimer(docId);

        expect(meta.flushTimer).toBeNull();
        expect(meta.compactTimer).toBeNull();
    });

    it('should save and compact on close', async () => {
        const meta = getOrCreateMeta(docId);
        meta.pending = [new Uint8Array([1, 2, 3])];

        prismaMock.$transaction.mockResolvedValue([] as any);
        prismaMock.documentUpdate.create.mockResolvedValue({} as any);

        await saveAndCompact(docId, doc);

        expect(prismaMock.documentUpdate.create).toHaveBeenCalled();
        expect(prismaMock.$transaction).toHaveBeenCalled();
        expect(meta.updateRowsSinceCompact).toBe(0);
    });
});
