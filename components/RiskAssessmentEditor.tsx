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
import { useSyncedStore } from '@syncedstore/react';
import { store, getYjsDoc } from '../lib/store';

interface RiskAssessmentEditorProps {
    documentId: string;
    userName: string;
}

const COLORS = ['#f87171', '#fb923c', '#fbbf24', '#a3e635', '#34d399', '#22d3ee', '#818cf8', '#c084fc'];

export default function RiskAssessmentEditor({ documentId, userName }: RiskAssessmentEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [users, setUsers] = useState<string[]>([]);

    // SyncedStore state
    const state = useSyncedStore(store);

    // Listen for browser online/offline events (crucial for DevTools offline simulation)
    useEffect(() => {
        const handleOnline = () => setIsOnline(true);
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
        };
    }, []);

    useEffect(() => {
        if (!editorRef.current) return;

        // Initialize Yjs document from the store
        const ydoc = getYjsDoc(store);
        const yXmlFragment = state.prosemirror;

        // Connect to WebSocket server
        // The server expects connections at /yjs/<docId>, so we append /yjs / to the base URL
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

        // Create ProseMirror editor state
        const editorState = EditorState.create({
            schema,
            plugins: [
                ySyncPlugin(yXmlFragment),
                yCursorPlugin(awareness),
                yUndoPlugin(),
                ...exampleSetup({ schema })
            ]
        });

        // Initialize editor view
        const view = new EditorView(editorRef.current, { state: editorState });

        viewRef.current = view;

        // Cleanup on unmount
        return () => {
            indexeddbProvider.destroy();
            provider.destroy();
            view.destroy();
        };
    }, [documentId, userName, state.prosemirror]);

    // Cybersecurity control catalog
    const CONTROL_CATALOG: Record<string, string> = {
        encryption_at_rest: 'Data Encryption at Rest',
        mfa_enforced: 'Multi-Factor Authentication',
        access_logging: 'Access Logging & Review',
        disaster_recovery: 'Disaster Recovery Plan',
        vulnerability_scan: 'Regular Vulnerability Scanning',
        incident_response: 'Incident Response Protocol',
    };

    // Helper to map CIA levels to numbers
    const ciaToWeight = (level: string = 'Low'): number => {
        const weights: Record<string, number> = {
            Low: 1,
            Medium: 3,
            High: 5,
            Critical: 7,
        };
        return weights[level] || 1;
    };

    // Effect to dynamically add/remove controls based on CIA scores
    useEffect(() => {
        const cScore = ciaToWeight(state.cia.confidentiality);
        const iScore = ciaToWeight(state.cia.integrity);
        const aScore = ciaToWeight(state.cia.availability);
        const totalScore = cScore + iScore + aScore;

        const requiredControls = new Set<string>();

        // Rule 1: C > 4 (High or Critical)
        if (cScore > 4) {
            ['encryption_at_rest', 'mfa_enforced', 'access_logging'].forEach(c => requiredControls.add(c));
        }

        // Rule 2: Total > 12
        if (totalScore > 12) {
            Object.keys(CONTROL_CATALOG).forEach(c => requiredControls.add(c));
        }

        // Add missing controls
        requiredControls.forEach(controlId => {
            if (state.controls[controlId] === undefined) {
                state.controls[controlId] = false;
            }
        });

        // Remove controls no longer required
        Object.keys(state.controls).forEach(controlId => {
            if (!requiredControls.has(controlId)) {
                delete state.controls[controlId];
            }
        });
    }, [state.cia.confidentiality, state.cia.integrity, state.cia.availability]);

    // Handler for CIA changes
    const handleCiaChange = (field: keyof typeof state.cia, value: string) => {
        state.cia[field] = value;
    };

    const toggleControl = (controlId: string) => {
        state.controls[controlId] = !state.controls[controlId];
    };

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            {/* Header / Meta */}
            <div className="flex justify-between items-start mb-6 pb-6 border-b border-gray-100">
                <div>
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Document Status</h2>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${!isOnline ? 'bg-amber-500' :
                            connectionStatus === 'connected' ? 'bg-green-500' :
                                connectionStatus === 'connecting' ? 'bg-yellow-500 animate-pulse' :
                                    'bg-amber-500'
                            }`}></span>
                        <span className={`font-medium text-sm ${!isOnline ? 'text-amber-700' :
                            connectionStatus === 'connected' ? 'text-green-700' :
                                connectionStatus === 'connecting' ? 'text-yellow-700' :
                                    'text-amber-700'
                            }`}>
                            {!isOnline ? 'Offline Mode' :
                                connectionStatus === 'connected' ? 'Synchronized' :
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
                            value={state.cia[metric] || 'Low'}
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

            {/* Dynamic Controls */}
            {Object.keys(state.controls).length > 0 && (
                <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-100">
                    <h3 className="text-sm font-bold text-blue-800 uppercase tracking-wider mb-4">Required Security Controls</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.keys(state.controls).map((controlId) => (
                            <div key={controlId} className="flex items-center gap-3 bg-white p-3 rounded border border-blue-200 shadow-sm">
                                <input
                                    type="checkbox"
                                    id={controlId}
                                    checked={state.controls[controlId]}
                                    onChange={() => toggleControl(controlId)}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <label htmlFor={controlId} className="text-sm font-medium text-gray-700 cursor-pointer">
                                    {CONTROL_CATALOG[controlId]}
                                </label>
                            </div>
                        ))}
                    </div>
                </div>
            )}

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
