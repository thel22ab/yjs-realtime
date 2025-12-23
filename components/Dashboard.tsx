'use client';

import { createDocument, getDocuments, deleteDocument } from '@/app/actions/documents';
import { startTransition, useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Document {
    id: string;
    title: string;
    confidentiality: number;
    integrity: number;
    availability: number;
    created_at: string;
}

// Helper to get color based on CIA level (0-3)
function getCIAColor(value: number): string {
    switch (value) {
        case 0: return 'bg-gray-200 text-gray-600';
        case 1: return 'bg-green-100 text-green-700';
        case 2: return 'bg-yellow-100 text-yellow-700';
        case 3: return 'bg-red-100 text-red-700';
        default: return 'bg-gray-200 text-gray-600';
    }
}

// Helper to get label for CIA level
function getCIALabel(value: number): string {
    switch (value) {
        case 0: return '-';
        case 1: return 'Low';
        case 2: return 'Med';
        case 3: return 'High';
        default: return '-';
    }
}

export default function Dashboard({ initialDocuments }: { initialDocuments: Document[] }) {
    const router = useRouter();
    const [documents, setDocuments] = useState(initialDocuments);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleDelete = async (e: React.MouseEvent, doc: Document) => {
        e.preventDefault();
        e.stopPropagation();

        if (!confirm(`Are you sure you want to delete "${doc.title}"? This action cannot be undone.`)) {
            return;
        }

        setDeletingId(doc.id);
        const result = await deleteDocument(doc.id);

        if (result.success) {
            setDocuments(docs => docs.filter(d => d.id !== doc.id));
        } else {
            alert('Failed to delete document. Please try again.');
        }
        setDeletingId(null);
    };

    return (
        <div className="max-w-4xl mx-auto p-8">
            <div className="flex justify-between items-center mb-8">
                <h1 className="text-3xl font-bold text-gray-800">Risk Assessments</h1>
                <form action={createDocument} className="flex gap-2">
                    <input
                        type="text"
                        name="title"
                        placeholder="New Assessment Title"
                        required
                        className="px-4 py-2 border rounded-md"
                    />
                    <button
                        type="submit"
                        className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition"
                    >
                        + New Assessment
                    </button>
                </form>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {documents.length === 0 ? (
                    <p className="text-gray-500 col-span-2 text-center py-8">No documents yet. Create one above.</p>
                ) : (
                    documents.map((doc) => (
                        <Link
                            key={doc.id}
                            href={`/document/${doc.id}`}
                            className="block p-6 bg-white border rounded-lg shadow-sm hover:shadow-md transition border-gray-200 relative group"
                        >
                            {/* Delete button */}
                            <button
                                onClick={(e) => handleDelete(e, doc)}
                                disabled={deletingId === doc.id}
                                className="absolute top-3 right-3 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition opacity-0 group-hover:opacity-100 disabled:opacity-50"
                                title="Delete document"
                            >
                                {deletingId === doc.id ? (
                                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                )}
                            </button>

                            <h3 className="text-xl font-semibold mb-2 text-gray-900 pr-10">{doc.title}</h3>

                            {/* CIA Subtitle */}
                            <div className="flex gap-2 mb-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCIAColor(doc.confidentiality)}`}>
                                    C: {getCIALabel(doc.confidentiality)}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCIAColor(doc.integrity)}`}>
                                    I: {getCIALabel(doc.integrity)}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${getCIAColor(doc.availability)}`}>
                                    A: {getCIALabel(doc.availability)}
                                </span>
                            </div>

                            <p className="text-sm text-gray-500">Created: {new Date(doc.created_at).toLocaleDateString()}</p>
                        </Link>
                    ))
                )}
            </div>
        </div>
    );
}

