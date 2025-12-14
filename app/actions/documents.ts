'use server';

import { redirect } from 'next/navigation';
import db from '@/lib/db';
import { randomUUID } from 'crypto';

export async function createDocument(formData: FormData) {
    const title = formData.get('title') as string;
    if (!title) {
        throw new Error('Title is required');
    }

    const id = randomUUID();
    try {
        await db.document.create({
            data: {
                id,
                title,
            },
        });
    } catch (error) {
        console.error('Failed to create document:', error);
        throw new Error('Failed to create document');
    }

    redirect(`/document/${id}`);
}

export async function getDocuments() {
    try {
        const docs = await db.document.findMany({
            orderBy: {
                createdAt: 'desc',
            },
        });
        return docs.map(doc => ({
            id: doc.id,
            title: doc.title,
            confidentiality: doc.confidentiality,
            integrity: doc.integrity,
            availability: doc.availability,
            created_at: doc.createdAt.toISOString(),
        }));
    } catch (error) {
        console.error('Failed to fetch documents:', error);
        return [];
    }
}

export async function getDocument(id: string) {
    try {
        const doc = await db.document.findUnique({
            where: { id },
        });

        if (!doc) return undefined;

        return {
            ...doc,
            created_at: doc.createdAt.toISOString(),
        };
    } catch (error) {
        console.error('Failed to fetch document:', error);
        return undefined;
    }
}
