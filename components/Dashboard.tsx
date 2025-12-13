'use client';

import { createDocument, getDocuments } from '@/app/actions/documents';
import { startTransition, useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Document {
    id: string;
    title: string;
    created_at: string;
}

export default function Dashboard({ initialDocuments }: { initialDocuments: Document[] }) {
    // We can use optimistic updates or just simple reload for now. 
    // Since we have initialDocuments passed from server, we can just display them.
    // Real-time updates for the list itself are not strictly required, but nice.

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
                            <p className="text-sm text-gray-500">Created: {new Date(doc.created_at).toLocaleDateString()}</p>
                        </Link>
                    ))
                )}
            </div>
        </div>
    );
}
