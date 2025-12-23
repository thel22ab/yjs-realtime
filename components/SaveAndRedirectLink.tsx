'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface SaveAndRedirectLinkProps {
    href: string;
    documentId: string;
    children: React.ReactNode;
    className?: string;
}

export function SaveAndRedirectLink({ href, documentId, children, className }: SaveAndRedirectLinkProps) {
    const router = useRouter();

    const handleClick = async (e: React.MouseEvent) => {
        e.preventDefault();

        console.log(`[UI] Triggering explicit save for ${documentId} before navigation...`);

        try {
            // Trigger explicit save via API
            // This is synchronous from the user's perspective, ensuring the DB is updated before they see the dashboard.
            const response = await fetch(`/api/documents/${documentId}/save`, {
                method: 'POST',
                // Use keepalive to ensure the request completes even if we navigate away
                keepalive: true
            });

            if (response.ok) {
                console.log(`[UI] Explicit save successful for ${documentId}`);
            } else {
                console.error(`[UI] Explicit save failed for ${documentId}`);
            }
        } catch (error) {
            console.error(`[UI] Error triggering explicit save:`, error);
        } finally {
            // Navigate regardless of whether save succeeded (best effort)
            router.push(href);
        }
    };

    return (
        <a href={href} onClick={handleClick} className={className}>
            {children}
        </a>
    );
}
