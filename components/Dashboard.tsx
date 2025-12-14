'use client';

import { createDocument, getDocuments } from '@/app/actions/documents';
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
                {initialDocuments.length === 0 ? (
                    <p className="text-gray-500 col-span-2 text-center py-8">No documents yet. Create one above.</p>
                ) : (
                    initialDocuments.map((doc) => (
                        <Link
                            key={doc.id}
                            href={`/document/${doc.id}`}
                            className="block p-6 bg-white border rounded-lg shadow-sm hover:shadow-md transition border-gray-200"
                        >
                            <h3 className="text-xl font-semibold mb-2 text-gray-900">{doc.title}</h3>

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

