/**
 * Dashboard Component
 * 
 * Displays a list of risk assessment documents with options to
 * create new assessments and delete existing ones.
 * 
 * @component
 */

'use client';

import { createDocument, getDocuments, deleteDocument } from '@/app/actions/documents';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { Trash2, CheckCircle2, Loader2 } from 'lucide-react';

// ---- Types ----

/**
 * Document summary displayed in the dashboard list.
 */
interface DocumentSummary {
    id: string;
    title: string;
    confidentiality: number;
    integrity: number;
    availability: number;
    createdAt: string;
}

// ---- CIA Display Helpers ----

/**
 * CIA numeric level type (0-3 based on database schema).
 */
type CiaLevel = 0 | 1 | 2 | 3;

/**
 * Maps CIA level number to CSS color class for badge styling.
 */
const CIA_LEVEL_COLORS: Record<CiaLevel, string> = {
    0: 'bg-gray-200 text-gray-600',
    1: 'bg-green-100 text-green-700',
    2: 'bg-yellow-100 text-yellow-700',
    3: 'bg-red-100 text-red-700',
};

/**
 * Maps CIA level number to display label.
 */
const CIA_LEVEL_LABELS: Record<CiaLevel, string> = {
    0: '-',
    1: 'Low',
    2: 'Med',
    3: 'High',
};

/**
 * Gets the color class for a CIA level badge.
 */
function getCIAColor(level: number): string {
    const normalizedLevel = Math.min(Math.max(Math.round(level), 0), 3) as CiaLevel;
    return CIA_LEVEL_COLORS[normalizedLevel];
}

/**
 * Gets the display label for a CIA level.
 */
function getCIALabel(level: number): string {
    const normalizedLevel = Math.min(Math.max(Math.round(level), 0), 3) as CiaLevel;
    return CIA_LEVEL_LABELS[normalizedLevel];
}

// ---- Component Props ----

interface DashboardProps {
    /** Initial documents to display when the component loads. */
    initialDocuments: DocumentSummary[];
}

// ---- Component ----

export default function Dashboard({ initialDocuments }: DashboardProps) {
    const router = useRouter();
    const [documents, setDocuments] = useState(initialDocuments);
    const [deletingDocument, setDeletingDocument] = useState<DocumentSummary | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);

    /**
     * Initiates the delete process for a document.
     */
    const handleDeleteClick = (event: React.MouseEvent, doc: DocumentSummary): void => {
        event.preventDefault();
        event.stopPropagation();
        setDeletingDocument(doc);
    };

    /**
     * Confirms and executes document deletion.
     */
    const confirmDelete = async (): Promise<void> => {
        if (!deletingDocument) return;

        setIsDeleting(true);
        const result = await deleteDocument(deletingDocument.id);

        if (result.success) {
            setDocuments(currentDocs => currentDocs.filter(d => d.id !== deletingDocument.id));
            setIsDeleting(false);
            setShowSuccess(true);
        } else {
            setIsDeleting(false);
            alert('Failed to delete document. Please try again.');
            setDeletingDocument(null);
        }
    };

    /**
     * Closes all modal dialogs and resets state.
     */
    const closeModals = (): void => {
        setDeletingDocument(null);
        setShowSuccess(false);
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
                    <p className="text-gray-500 col-span-2 text-center py-8">
                        No documents yet. Create one above.
                    </p>
                ) : (
                    documents.map((doc) => (
                        <Link
                            key={doc.id}
                            href={`/document/${doc.id}`}
                            className="block p-6 bg-white border rounded-lg shadow-sm hover:shadow-md transition border-gray-200 relative group"
                        >
                            {/* Delete button */}
                            <button
                                onClick={(e) => handleDeleteClick(e, doc)}
                                className="absolute top-3 right-3 p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition opacity-0 group-hover:opacity-100"
                                title="Delete document"
                            >
                                <Trash2 className="w-5 h-5" />
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

                            <p className="text-sm text-gray-500">
                                Created: {new Date(doc.createdAt).toLocaleDateString()}
                            </p>
                        </Link>
                    ))
                )}
            </div>

            {/* Confirmation Modal */}
            <AlertDialog open={!!deletingDocument && !showSuccess} onOpenChange={(open) => !open && closeModals()}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete Risk Assessment</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong className="text-foreground">"{deletingDocument?.title}"</strong>?
                            This action cannot be undone and will remove all associated data.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => {
                                e.preventDefault();
                                void confirmDelete();
                            }}
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={isDeleting}
                        >
                            {isDeleting ? (
                                <>
                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                    Deleting...
                                </>
                            ) : (
                                'Delete Assessment'
                            )}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Success Modal */}
            <AlertDialog open={showSuccess} onOpenChange={(open) => !open && closeModals()}>
                <AlertDialogContent className="sm:max-w-md">
                    <div className="flex flex-col items-center justify-center pt-4 pb-2">
                        <div className="bg-green-100 p-3 rounded-full mb-4">
                            <CheckCircle2 className="w-8 h-8 text-green-600" />
                        </div>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-center">Document Deleted</AlertDialogTitle>
                            <AlertDialogDescription className="text-center">
                                The risk assessment has been successfully removed from your dashboard.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                    </div>
                    <AlertDialogFooter className="sm:justify-center">
                        <AlertDialogAction onClick={closeModals} className="w-full sm:w-auto">
                            Got it
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
