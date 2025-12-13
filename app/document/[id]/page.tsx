import { getDocument } from '@/app/actions/documents';
import RiskAssessmentEditor from '@/components/RiskAssessmentEditor';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
    params: Promise<{ id: string }>;
}

export default async function DocumentPage({ params }: PageProps) {
    const { id } = await params;
    const doc = await getDocument(id);

    if (!doc) {
        notFound();
    }

    // Generate a random user name for demo purposes
    const demoUsers = ['Alice', 'Bob', 'Charlie', 'Dave', 'Eve'];
    const userName = demoUsers[Math.floor(Math.random() * demoUsers.length)];

    return (
        <div className="min-h-screen bg-gray-50 flex flex-col">
            <header className="bg-white border-b border-gray-200 px-8 py-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/" className="text-gray-500 hover:text-gray-800 transition">
                        ← Back to Dashboard
                    </Link>
                    <h1 className="text-xl font-bold text-gray-900 border-l border-gray-200 pl-4">
                        {doc.title}
                    </h1>
                </div>
                <div className="text-sm text-gray-500">
                    Logged in as <span className="font-semibold text-gray-900">{userName}</span>
                </div>
            </header>

            <main className="flex-1 p-8 max-w-5xl mx-auto w-full">
                <RiskAssessmentEditor documentId={id} userName={userName} />
            </main>
        </div>
    );
}
