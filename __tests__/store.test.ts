/**
 * Unit tests for the SyncedStore configuration.
 * Tests store creation and Yjs document integration.
 */

import { createStore, getYjsDoc } from '@/lib/store';
import * as Y from 'yjs';

describe('Store Configuration', () => {
    describe('createStore', () => {
        it('creates a store instance with all required sections', () => {
            const store = createStore();

            expect(store.cia).toBeDefined();
            expect(store.controls).toBeDefined();
            expect(store.prosemirror).toBeDefined();
        });

        it('initializes CIA section with empty values', () => {
            const store = createStore();

            expect(store.cia.confidentiality).toBeUndefined();
            expect(store.cia.integrity).toBeUndefined();
            expect(store.cia.availability).toBeUndefined();
        });

        it('initializes controls section as empty object', () => {
            const store = createStore();

            expect(store.controls).toEqual({});
        });

        it('creates independent store instances', () => {
            const store1 = createStore();
            const store2 = createStore();

            // Modifying one store should not affect the other
            store1.cia.confidentiality = 'High';
            expect(store2.cia.confidentiality).toBeUndefined();
        });
    });

    describe('getYjsDoc', () => {
        it('extracts the underlying Yjs document from a store', () => {
            const store = createStore();
            const yjsDocument = getYjsDoc(store);

            expect(yjsDocument).toBeInstanceOf(Y.Doc);
        });

        it('returns the same Yjs document instance for the same store', () => {
            const store = createStore();
            const doc1 = getYjsDoc(store);
            const doc2 = getYjsDoc(store);

            expect(doc1).toBe(doc2);
        });

        it('synchronizes changes from store back to Yjs document', () => {
            const store = createStore();
            const yjsDocument = getYjsDoc(store);

            // Modify store value
            store.cia.confidentiality = 'High';

            // Verify Yjs document reflects the change
            const ciaMap = yjsDocument.getMap('cia');
            expect(ciaMap.get('confidentiality')).toBe('High');
        });
    });
});
