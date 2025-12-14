'use client';

import { useEffect, useRef, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { exampleSetup } from 'prosemirror-example-setup';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';

interface RiskAssessmentEditorProps {
    documentId: string;
    userName: string;
}

const COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8', '#c084fc'];

export default function RiskAssessmentEditor({ documentId, userName }: RiskAssessmentEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [users, setUsers] = useState<string[]>([]);

    // Local state for CIA form fields
    const [cia, setCia] = useState({
        confidentiality: 'Low',
        integrity: 'Low',
        availability: 'Low',
    });

    // Yjs refs for CIA updates
    const ydocRef = useRef<Y.Doc | null>(null);

    useEffect(() => {
        if (!editorRef.current) return;

        // Initialize Yjs document and shared types
        const ydoc = new Y.Doc();
        ydocRef.current = ydoc;
        const yXmlFragment = ydoc.getXmlFragment('prosemirror');

        // Connect to WebSocket server
        // The server expects connections at /yjs/<docId>, so we append /yjs to the base URL
        const provider = new WebsocketProvider(
            (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000') + '/yjs',
            documentId,
            ydoc,
            { connect: true }
        );

        // IndexedDB persistence for offline support

        const indexeddbProvider = new IndexeddbPersistence(documentId, ydoc);
        indexeddbProvider.on('synced', () => {
            console.log('Local content loaded from IndexedDB');
        });

        provider.on('status', (event: { status: string }) => {
            setConnectionStatus(event.status as 'connecting' | 'connected' | 'disconnected');
        });

        // Configure awareness for cursor positions
        const awareness = provider.awareness;
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        awareness.setLocalStateField('user', { name: userName, color });

        awareness.on('change', () => {
            const states = Array.from(awareness.getStates().values()) as any[];
            const activeUsers = states.map(s => s.user?.name).filter(Boolean);
            setUsers(activeUsers);
        });

        // CIA Map binding (Key-Value Store)
        const ciaMap = ydoc.getMap('cia');
        const updateLocalCia = () => {
            setCia({
                confidentiality: (ciaMap.get('confidentiality') as string) || 'Low',
                integrity: (ciaMap.get('integrity') as string) || 'Low',
                availability: (ciaMap.get('availability') as string) || 'Low',
            });
        };
        // Using observer pattern to update local state when remote changes arrive 'Observe all events that are created on this type.
        ciaMap.observe(updateLocalCia);

        // Create ProseMirror editor state
        const state = EditorState.create({
            schema,
            plugins: [
                ySyncPlugin(yXmlFragment),
                yCursorPlugin(awareness),
                yUndoPlugin(),
                ...exampleSetup({ schema })
            ]
        });

        // Initialize editor view
        const view = new EditorView(editorRef.current, { state });

        viewRef.current = view;

        // Cleanup on unmount
        return () => {
            indexeddbProvider.destroy();
            provider.destroy();
            view.destroy();
        };
    }, [documentId, userName]);

    // Handler for CIA changes
    const handleCiaChange = (field: keyof typeof cia, value: string) => {
        if (!ydocRef.current) return;
        const ciaMap = ydocRef.current.getMap('cia');
        ciaMap.set(field, value);
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            {/* Header / Meta */}
            <div className="flex justify-between items-start mb-6 pb-6 border-b border-gray-100">
                <div>
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Document Status</h2>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' :
                            connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                                'bg-amber-500'
                            }`}></span>
                        <span className={`font-medium text-sm ${connectionStatus === 'connected' ? 'text-green-700' :
                            connectionStatus === 'connecting' ? 'text-yellow-700' :
                                'text-amber-700'
                            }`}>
                            {connectionStatus === 'connected' ? 'Synchronized' :
                                connectionStatus === 'connecting' ? 'Connecting...' :
                                    'Offline Mode'}
                        </span>
                    </div>
                </div>

                <div className="flex -space-x-2">
                    {users.map((u, i) => (
                        <div key={i} className="w-8 h-8 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-xs font-bold text-blue-600" title={u}>
                            {u.charAt(0).toUpperCase()}
                        </div>
                    ))}
                </div>
            </div>

            {/* CIA Dropdowns */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                {(['confidentiality', 'integrity', 'availability'] as const).map((metric) => (
                    <div key={metric} className="p-4 bg-gray-50 rounded-lg">
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">{metric}</label>
                        <select
                            value={cia[metric]}
                            onChange={(e) => handleCiaChange(metric, e.target.value)}
                            className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none transition"
                        >
                            <option value="Low">Low</option>
                            <option value="Medium">Medium</option>
                            <option value="High">High</option>
                            <option value="Critical">Critical</option>
                        </select>
                    </div>
                ))}
            </div>

            {/* ProseMirror Editor */}
            <div>
                <label className="block text-sm font-bold text-gray-700 mb-2">Assessment Notes</label>
                <div ref={editorRef} className="editor-container" />
                <p className="text-xs text-gray-400 mt-2 text-right">Changes sync automatically • Collaborative cursors enabled</p>
            </div>

            {/* ProseMirror styles */}
            <style jsx global>{`
                .editor-container .ProseMirror {
                    min-height: 12rem;
                    padding: 1rem;
                    border: 1px solid #e5e7eb;
                    border-radius: 0.5rem;
                    background-color: #f9fafb;
                    color: #1f2937;
                    outline: none;
                }
                .editor-container .ProseMirror:focus {
                    outline: none;
                    border-color: #3b82f6;
                    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
                }
                .editor-container .ProseMirror p {
                    margin: 0 0 0.5rem 0;
                }
                .editor-container .ProseMirror p:last-child {
                    margin-bottom: 0;
                }
                /* Hide the menu bar from example-setup */
                .editor-container .ProseMirror-menubar {
                    display: none;
                }
                /* Remote cursor styles */
                .yRemoteSelection {
                    background-color: rgba(59, 130, 246, 0.3);
                }
                .yRemoteSelectionHead {
                    position: absolute;
                    border-left: 2px solid;
                    border-color: inherit;
                    height: 1.2em;
                    margin-left: -1px;
                }
                .yRemoteSelectionHead::after {
                    content: attr(data-user);
                    position: absolute;
                    left: -1px;
                    top: -1.2em;
                    font-size: 0.65rem;
                    padding: 1px 4px;
                    background-color: inherit;
                    color: white;
                    border-radius: 2px;
                    white-space: nowrap;
                }
            `}</style>
        </div>
    );
}
