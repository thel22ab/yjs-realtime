import { createStore, getYjsDoc } from '@/lib/store';
import * as Y from 'yjs';

describe('Store', () => {
    it('should create a store with default values', () => {
        const store = createStore();
        expect(store.cia).toBeDefined();
        expect(store.controls).toBeDefined();
        expect(store.prosemirror).toBeDefined();
    });

    it('should be able to get the underlying Yjs doc', () => {
        const store = createStore();
        const doc = getYjsDoc(store);
        expect(doc).toBeInstanceOf(Y.Doc);
    });

    it('should sync values back to Yjs doc', () => {
        const store = createStore();
        const doc = getYjsDoc(store);

        store.cia.confidentiality = 'High';

        const ciaMap = doc.getMap('cia');
        expect(ciaMap.get('confidentiality')).toBe('High');
    });
});
