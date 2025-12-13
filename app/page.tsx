import Dashboard from '@/components/Dashboard';
import { getDocuments } from '@/app/actions/documents';

export const dynamic = 'force-dynamic'; // Ensure we always fetch fresh data

export default async function Home() {
    const documents = await getDocuments();

    return (
        <main className="min-h-screen bg-gray-50">
            <Dashboard initialDocuments={documents} />
        </main>
    );
}