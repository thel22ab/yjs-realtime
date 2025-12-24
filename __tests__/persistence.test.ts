/**
 * Unit tests for the persistence layer.
 * Tests document metadata management, flush scheduling, and compaction operations.
 */

import * as Y from 'yjs';
import { getOrCreateMeta, scheduleFlush, stopCompactionTimer, saveAndCompact } from '@/persistence';
import { prismaMock } from '../jest.setup';

jest.useFakeTimers();

describe('Persistence Layer', () => {
    const testDocumentId = 'test-document-id';
    let testDocument: Y.Doc;

    beforeEach(() => {
        testDocument = new Y.Doc();
        // Clear metadata for this document before each test
        stopCompactionTimer(testDocumentId);
    });

    afterEach(() => {
        // Clean up after each test
        stopCompactionTimer(testDocumentId);
        testDocument.destroy();
    });

    describe('DocumentMetadata', () => {
        describe('getOrCreateMeta', () => {
            it('creates new metadata when document has not been tracked', () => {
                const metadata = getOrCreateMeta(testDocumentId);

                expect(metadata).toBeDefined();
                expect(metadata.pendingUpdates).toEqual([]);
                expect(metadata.flushTimer).toBeNull();
                expect(metadata.compactionTimer).toBeNull();
                expect(metadata.updatesSinceLastCompaction).toBe(0);
            });

            it('returns the same metadata instance for repeated calls with same document', () => {
                const firstMetadata = getOrCreateMeta(testDocumentId);
                const secondMetadata = getOrCreateMeta(testDocumentId);

                expect(firstMetadata).toBe(secondMetadata);
            });

            it('updates the Yjs document reference when one is provided', () => {
                const metadata = getOrCreateMeta(testDocumentId, testDocument);

                expect(metadata.yjsDocument).toBe(testDocument);
            });
        });
    });

    describe('Flush Scheduling', () => {
        it('schedules a flush that writes pending updates after debounce delay', async () => {
            const testDocId = `flush-test-${Date.now()}`; // Use unique ID
            const doc = new Y.Doc();
            
            try {
                const metadata = getOrCreateMeta(testDocId, doc);
                const testUpdate = new Uint8Array([1, 2, 3]);
                
                metadata.pendingUpdates = [testUpdate];

                scheduleFlush(testDocId, doc);

                // Verify flush has not been called immediately (debounced)
                expect(prismaMock.documentUpdate.create).not.toHaveBeenCalled();

                // Advance timers past the debounce delay (50ms)
                jest.advanceTimersByTime(50);

                // Allow promises to resolve (flush is async)
                await Promise.resolve();
                await Promise.resolve();

                // Verify flush was called
                expect(prismaMock.documentUpdate.create).toHaveBeenCalled();
            } finally {
                stopCompactionTimer(testDocId);
                doc.destroy();
            }
        });

        it('does not schedule duplicate flushes when one is already pending', () => {
            const testDocId = `dedup-test-${Date.now()}`; // Use unique ID
            const doc = new Y.Doc();
            
            try {
                const metadata = getOrCreateMeta(testDocId, doc);
                metadata.flushTimer = setTimeout(() => {}, 100) as unknown as NodeJS.Timeout;

                const initialFlushTimer = metadata.flushTimer;

                scheduleFlush(testDocId, doc);

                // The existing timer should be cleared and replaced
                expect(metadata.flushTimer).not.toBe(initialFlushTimer);
            } finally {
                stopCompactionTimer(testDocId);
                doc.destroy();
            }
        });
    });

    describe('Timer Management', () => {
        it('clears both flush and compaction timers when stopping compaction', () => {
            const testDocId = `timer-test-${Date.now()}`; // Use unique ID
            const doc = new Y.Doc();
            
            try {
                const metadata = getOrCreateMeta(testDocId, doc);
                
                metadata.flushTimer = setTimeout(() => {}, 100) as unknown as NodeJS.Timeout;
                metadata.compactionTimer = setInterval(() => {}, 100) as unknown as NodeJS.Timeout;

                stopCompactionTimer(testDocId);

                expect(metadata.flushTimer).toBeNull();
                expect(metadata.compactionTimer).toBeNull();
            } finally {
                stopCompactionTimer(testDocId);
                doc.destroy();
            }
        });

        it('handles stopping timer for non-existent document gracefully', () => {
            expect(() => {
                stopCompactionTimer('non-existent-doc');
            }).not.toThrow();
        });
    });

    describe('Document Save and Compact', () => {
        it('flushes pending updates and performs compaction when document is closed', async () => {
            const testDocId = `save-test-${Date.now()}`; // Use unique ID
            const doc = new Y.Doc();
            
            try {
                const metadata = getOrCreateMeta(testDocId, doc);
                const testUpdate = new Uint8Array([1, 2, 3]);
                
                metadata.pendingUpdates = [testUpdate];

                prismaMock.$transaction.mockResolvedValue([] as any);
                prismaMock.documentUpdate.create.mockResolvedValue({} as any);

                await saveAndCompact(testDocId, doc);

                // Verify update was created
                expect(prismaMock.documentUpdate.create).toHaveBeenCalled();
                // Verify compaction transaction was executed
                expect(prismaMock.$transaction).toHaveBeenCalled();
                // Verify updates counter was reset
                expect(metadata.updatesSinceLastCompaction).toBe(0);
            } finally {
                stopCompactionTimer(testDocId);
                doc.destroy();
            }
        });

        it('compacts document even when no pending updates exist', async () => {
            const testDocId = `compact-test-${Date.now()}`; // Use unique ID
            const doc = new Y.Doc();
            
            try {
                const metadata = getOrCreateMeta(testDocId, doc);
                metadata.updatesSinceLastCompaction = 0; // No updates

                prismaMock.$transaction.mockResolvedValue([] as any);

                await saveAndCompact(testDocId, doc);

                // Compaction should still be forced on close
                expect(prismaMock.$transaction).toHaveBeenCalled();
            } finally {
                stopCompactionTimer(testDocId);
                doc.destroy();
            }
        });
    });
});
