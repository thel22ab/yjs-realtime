/**
 * Version History Dropdown Component
 * 
 * Displays a dropdown showing document version history with the ability
 * to view and revert to previous versions.
 * 
 * @component
 */

'use client';

import { useState, useEffect, useCallback } from 'react';

// ---- Types ----

interface VersionItem {
    id: number;
    label: string | null;
    createdAt: string;
}

interface VersionHistoryDropdownProps {
    /** Document ID to fetch versions for */
    documentId: string;
    /** Callback when a version is successfully reverted */
    onRevert?: (versionId: number) => void;
}

// ---- Helper Functions ----

/**
 * Formats a date string for display.
 */
function formatVersionDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Relative time for recent versions
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

    // Absolute date for older versions
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
        hour: '2-digit',
        minute: '2-digit',
    });
}

// ---- Component ----

export default function VersionHistoryDropdown({
    documentId,
    onRevert,
}: VersionHistoryDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [versions, setVersions] = useState<VersionItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revertingId, setRevertingId] = useState<number | null>(null);
    const [confirmRevertId, setConfirmRevertId] = useState<number | null>(null);

    // ---- Fetch Versions ----

    const fetchVersions = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/documents/${documentId}/versions`);
            if (!response.ok) {
                throw new Error('Failed to fetch versions');
            }

            const data = await response.json();
            setVersions(data.versions || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load versions');
            console.error('Failed to fetch versions:', err);
        } finally {
            setIsLoading(false);
        }
    }, [documentId]);

    // Fetch versions when dropdown opens
    useEffect(() => {
        if (isOpen) {
            fetchVersions();
        }
    }, [isOpen, fetchVersions]);

    // ---- Create Version ----

    const handleCreateVersion = async () => {
        setIsLoading(true);
        setError(null);

        try {
            const label = `Manual save - ${new Date().toLocaleString()}`;
            const response = await fetch(`/api/documents/${documentId}/versions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label }),
            });

            if (!response.ok) {
                throw new Error('Failed to create version');
            }

            // Refresh the version list
            await fetchVersions();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to create version');
            console.error('Failed to create version:', err);
        } finally {
            setIsLoading(false);
        }
    };

    // ---- Revert to Version ----

    const handleRevert = async (versionId: number) => {
        setRevertingId(versionId);
        setError(null);

        try {
            const response = await fetch(
                `/api/documents/${documentId}/versions/${versionId}/revert`,
                { method: 'POST' }
            );

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to revert');
            }

            // Success - close dropdown and notify parent
            setConfirmRevertId(null);
            setIsOpen(false);
            onRevert?.(versionId);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to revert');
            console.error('Failed to revert:', err);
        } finally {
            setRevertingId(null);
        }
    };

    // ---- Render ----

    return (
        <div className="relative">
            {/* Dropdown Trigger */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 transition-colors"
                aria-expanded={isOpen}
                aria-haspopup="true"
            >
                <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                </svg>
                <span>History</span>
                <svg
                    className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M19 9l-7 7-7-7"
                    />
                </svg>
            </button>

            {/* Dropdown Panel */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => {
                            setIsOpen(false);
                            setConfirmRevertId(null);
                        }}
                    />

                    {/* Panel */}
                    <div className="absolute right-0 z-20 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden">
                        {/* Header */}
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                            <h3 className="text-sm font-semibold text-gray-800">
                                Version History
                            </h3>
                            <button
                                onClick={handleCreateVersion}
                                disabled={isLoading}
                                className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Save Version
                            </button>
                        </div>

                        {/* Content */}
                        <div className="max-h-80 overflow-y-auto">
                            {/* Loading State */}
                            {isLoading && versions.length === 0 && (
                                <div className="px-4 py-8 text-center text-gray-500">
                                    <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
                                    Loading versions...
                                </div>
                            )}

                            {/* Error State */}
                            {error && (
                                <div className="px-4 py-3 bg-red-50 text-red-700 text-sm border-b border-red-100">
                                    {error}
                                </div>
                            )}

                            {/* Empty State */}
                            {!isLoading && versions.length === 0 && !error && (
                                <div className="px-4 py-8 text-center text-gray-500 text-sm">
                                    <svg
                                        className="w-10 h-10 mx-auto mb-2 text-gray-300"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={1.5}
                                            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                                        />
                                    </svg>
                                    No saved versions yet
                                    <br />
                                    <span className="text-xs text-gray-400">
                                        Click &quot;Save Version&quot; to create one
                                    </span>
                                </div>
                            )}

                            {/* Current Version Indicator */}
                            {versions.length > 0 && (
                                <div className="px-4 py-3 border-b border-gray-100 bg-green-50">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                                        <span className="text-sm font-medium text-green-800">
                                            Current Version
                                        </span>
                                    </div>
                                    <p className="text-xs text-green-600 mt-1 ml-4">
                                        Live editing in progress
                                    </p>
                                </div>
                            )}

                            {/* Version List */}
                            {versions.map((version) => (
                                <div
                                    key={version.id}
                                    className="px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
                                >
                                    {confirmRevertId === version.id ? (
                                        /* Confirmation UI */
                                        <div className="space-y-2">
                                            <p className="text-sm text-gray-800">
                                                Revert to this version? All users will see the change.
                                            </p>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleRevert(version.id)}
                                                    disabled={revertingId !== null}
                                                    className="flex-1 px-3 py-1.5 text-xs font-medium text-white bg-red-600 rounded hover:bg-red-700 disabled:opacity-50 transition-colors"
                                                >
                                                    {revertingId === version.id ? 'Reverting...' : 'Confirm Revert'}
                                                </button>
                                                <button
                                                    onClick={() => setConfirmRevertId(null)}
                                                    disabled={revertingId !== null}
                                                    className="flex-1 px-3 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Normal Version Display */
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="text-sm text-gray-800">
                                                    {formatVersionDate(version.createdAt)}
                                                </p>
                                                {version.label && (
                                                    <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[180px]">
                                                        {version.label}
                                                    </p>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => setConfirmRevertId(version.id)}
                                                className="px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                            >
                                                Revert
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* Footer */}
                        {versions.length > 0 && (
                            <div className="px-4 py-2 bg-gray-50 border-t border-gray-200">
                                <p className="text-xs text-gray-500 text-center">
                                    {versions.length} version{versions.length !== 1 ? 's' : ''} saved
                                </p>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
