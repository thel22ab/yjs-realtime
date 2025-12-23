import { syncedStore, getYjsDoc } from "@syncedstore/core";

interface StoreShape {
    cia: {
        confidentiality?: string;
        integrity?: string;
        availability?: string;
    };
    controls: Record<string, boolean>;
    prosemirror: any;
}

export const store = syncedStore({
    cia: {},
    controls: {},
    prosemirror: "xml",
}) as StoreShape;

export { getYjsDoc };
