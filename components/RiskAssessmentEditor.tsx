/**
 * Risk Assessment Editor Component
 * 
 * Provides a collaborative editor for risk assessments with:
 * - Real-time collaboration via Yjs and WebSockets
 * - CIA (Confidentiality, Integrity, Availability) scoring
 * - Dynamic security control recommendations
 * - Offline support via IndexedDB
 * 
 * @component
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { schema } from 'prosemirror-schema-basic';
import { exampleSetup } from 'prosemirror-example-setup';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from 'y-prosemirror';
import { useSyncedStore } from '@syncedstore/react';
import { createStore, getYjsDoc } from '@/lib/store';

// ---- Types ----

/**
 * Props for the RiskAssessmentEditor component.
 */
interface RiskAssessmentEditorProps {
    /** Unique identifier for the document being edited. */
    documentId: string;

    /** Name of the user for presence/awareness display. */
    userName: string;
}

// ---- Configuration Constants ----

/** Available user cursor colors for collaborative editing. */
const CURSOR_COLORS = [
    '#f87171', '#fb923c', '#fbbf24', '#a3e635',
    '#34d399', '#22d3ee', '#818cf8', '#c084fc'
];

/** CIA level values for dropdown selection. */
const CIA_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;

/** Default CIA level when none is selected. */
const DEFAULT_CIA_LEVEL = 'Low';

// ---- Security Control Catalog ----

/**
 * Catalog of security controls available for risk assessments.
 * Controls are dynamically shown based on CIA scores.
 */
const SECURITY_CONTROL_CATALOG: Record<string, string> = {
    encryption_at_rest: 'Data Encryption at Rest',
    mfa_enforced: 'Multi-Factor Authentication',
    access_logging: 'Access Logging & Review',
    disaster_recovery: 'Disaster Recovery Plan',
    vulnerability_scan: 'Regular Vulnerability Scanning',
    incident_response: 'Incident Response Protocol',
};

// ---- CIA Weight Configuration ----

/**
 * CIA level risk weight mappings.
 * 
 * These weights follow industry-standard risk assessment formulas:
 * - Low (1): Minimal impact requiring standard controls
 * - Medium (3): Moderate impact requiring enhanced controls  
 * - High (5): Significant impact requiring strict controls
 * - Critical (7): Severe impact requiring maximum security measures
 * 
 * @see NIST SP 800-30 Risk Assessment Framework
 */
const CIA_LEVEL_WEIGHTS: Record<string, number> = {
    Low: 1,
    Medium: 3,
    High: 5,
    Critical: 7,
};

/**
 * CIA level type.
 */
type CiaLevel = typeof CIA_LEVELS[number];

/**
 * Converts a CIA level string to its numeric risk weight.
 * 
 * @param level - The CIA level string (e.g., 'High')
 * @returns The numeric weight for risk calculations
 */
function calculateCiaWeight(level: string = DEFAULT_CIA_LEVEL): number {
    return CIA_LEVEL_WEIGHTS[level] ?? 1;
}

// ---- Helper Functions ----

/**
 * Determines which security controls are required based on CIA scores.
 * 
 * @param confidentialityScore - Confidentiality risk score
 * @param integrityScore - Integrity risk score
 * @param availabilityScore - Availability risk score
 * @returns Set of control IDs that should be enabled
 */
function calculateRequiredControls(
    confidentialityScore: number,
    integrityScore: number,
    availabilityScore: number
): Set<string> {
    const totalScore = confidentialityScore + integrityScore + availabilityScore;
    const requiredControls = new Set<string>();

    // Rule 1: High confidentiality (> 4) requires encryption and access controls
    if (confidentialityScore > 4) {
        ['encryption_at_rest', 'mfa_enforced', 'access_logging'].forEach(control =>
            requiredControls.add(control)
        );
    }

    // Rule 2: High total risk (> 12) requires all controls
    if (totalScore > 12) {
        Object.keys(SECURITY_CONTROL_CATALOG).forEach(control =>
            requiredControls.add(control)
        );
    }

    return requiredControls;
}

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const STATUS_CONFIG = {
    offline: { text: 'Offline Mode', indicator: 'bg-amber-500', textClass: 'text-amber-700' },
    connected: { text: 'Synchronized', indicator: 'bg-green-500', textClass: 'text-green-700' },
    connecting: { text: 'Connecting...', indicator: 'bg-yellow-500 animate-pulse', textClass: 'text-yellow-700' },
} as const;

function getStatusKey(isOnline: boolean, status: ConnectionStatus): keyof typeof STATUS_CONFIG {
    return !isOnline || status === 'disconnected' ? 'offline' : status;
}

// ---- Component ----

export default function RiskAssessmentEditor({
    documentId,
    userName
}: RiskAssessmentEditorProps) {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
    const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [activeUsers, setActiveUsers] = useState<string[]>([]);

    // Create store instance for this document
    const docStore = useMemo(() => createStore(), [documentId]);
    const storeState = useSyncedStore(docStore);

    // ---- Online/Offline Detection ----

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

    // ---- Editor Initialization ----

    useEffect(() => {
        if (!editorRef.current) return;

        // Initialize Yjs document from the local store
        const yjsDocument = getYjsDoc(docStore);
        // Get the raw Yjs XmlFragment directly (not through proxy) for y-prosemirror
        const yXmlFragment = yjsDocument.getXmlFragment('prosemirror');

        // Connect to WebSocket server
        const wsUrl = (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3000') + '/yjs';
        const provider = new WebsocketProvider(wsUrl, documentId, yjsDocument, { connect: true });

        // IndexedDB persistence for offline support
        const indexeddbProvider = new IndexeddbPersistence(documentId, yjsDocument);
        indexeddbProvider.on('synced', () => {
            console.log('Local content loaded from IndexedDB');
        });

        provider.on('status', (event: { status: string }) => {
            setConnectionStatus(event.status as 'connecting' | 'connected' | 'disconnected');
        });

        // Configure awareness for cursor positions
        const awareness = provider.awareness;
        const userColor = CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
        awareness.setLocalStateField('user', { name: userName, color: userColor });

        awareness.on('change', () => {
            const states = Array.from(awareness.getStates().values()) as Array<{ user?: { name: string } }>;
            const users = states.map(s => s.user?.name).filter((name): name is string => Boolean(name));
            setActiveUsers(users);
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
    }, [documentId, userName, docStore]);

    // ---- Dynamic Control Management ----

    useEffect(() => {
        const confidentialityScore = calculateCiaWeight(storeState.cia.confidentiality ?? DEFAULT_CIA_LEVEL);
        const integrityScore = calculateCiaWeight(storeState.cia.integrity ?? DEFAULT_CIA_LEVEL);
        const availabilityScore = calculateCiaWeight(storeState.cia.availability ?? DEFAULT_CIA_LEVEL);

        const requiredControls = calculateRequiredControls(
            confidentialityScore,
            integrityScore,
            availabilityScore
        );

        // Add missing required controls
        requiredControls.forEach(controlId => {
            if (storeState.controls[controlId] === undefined) {
                storeState.controls[controlId] = false;
            }
        });

        // Remove controls no longer required
        Object.keys(storeState.controls).forEach(controlId => {
            if (!requiredControls.has(controlId)) {
                delete storeState.controls[controlId];
            }
        });
    }, [
        storeState.cia.confidentiality,
        storeState.cia.integrity,
        storeState.cia.availability
    ]);

    const handleCiaChange = (field: keyof typeof storeState.cia, value: string) => {
        storeState.cia[field] = value;
    };

    const toggleControl = (controlId: string) => {
        storeState.controls[controlId] = !storeState.controls[controlId];
    };

    // ---- Render ----

    const status = STATUS_CONFIG[getStatusKey(isOnline, connectionStatus)];

    return (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            {/* Header / Meta */}
            <div className="flex justify-between items-start mb-6 pb-6 border-b border-gray-100">
                <div>
                    <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-1">Document Status</h2>
                    <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${status.indicator}`}></span>
                        <span className={`font-medium text-sm ${status.textClass}`}>
                            {status.text}
                        </span>
                    </div>
                </div>

                <div className="flex -space-x-2">
                    {activeUsers.map((user, index) => (
                        <div
                            key={index}
                            className="w-8 h-8 rounded-full bg-blue-100 border-2 border-white flex items-center justify-center text-xs font-bold text-blue-600"
                            title={user}
                        >
                            {user.charAt(0).toUpperCase()}
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
                            value={storeState.cia[metric] || DEFAULT_CIA_LEVEL}
                            onChange={(e) => handleCiaChange(metric, e.target.value)}
                            className="w-full bg-white border border-gray-200 text-gray-800 text-sm rounded-md p-2 focus:ring-2 focus:ring-blue-500 outline-none transition"
                        >
                            {CIA_LEVELS.map(level => (
                                <option key={level} value={level}>{level}</option>
                            ))}
                        </select>
                    </div>
                ))}
            </div>

            {/* Dynamic Controls */}
            {Object.keys(storeState.controls).length > 0 && (
                <div className="mb-8 p-6 bg-blue-50 rounded-lg border border-blue-100">
                    <h3 className="text-sm font-bold text-blue-800 uppercase tracking-wider mb-4">Required Security Controls</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {Object.keys(storeState.controls).map((controlId) => (
                            <div key={controlId} className="flex items-center gap-3 bg-white p-3 rounded border border-blue-200 shadow-sm">
                                <input
                                    type="checkbox"
                                    id={controlId}
                                    checked={storeState.controls[controlId]}
                                    onChange={() => toggleControl(controlId)}
                                    className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                />
                                <label htmlFor={controlId} className="text-sm font-medium text-gray-700 cursor-pointer">
                                    {SECURITY_CONTROL_CATALOG[controlId]}
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
