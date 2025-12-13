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
        const stmt = db.prepare('INSERT INTO documents (id, title) VALUES (?, ?)');
        stmt.run(id, title);
    } catch (error) {
        console.error('Failed to create document:', error);
        throw new Error('Failed to create document');
    }

    redirect(`/document/${id}`);
}

export async function getDocuments() {
    try {
        const stmt = db.prepare('SELECT * FROM documents ORDER BY created_at DESC');
        return stmt.all() as { id: string; title: string; created_at: string }[];
    } catch (error) {
        console.error('Failed to fetch documents:', error);
        return [];
    }
}

export async function getDocument(id: string) {
    try {
        const stmt = db.prepare('SELECT * FROM documents WHERE id = ?');
        return stmt.get(id) as { id: string; title: string; created_at: string } | undefined;
    } catch (error) {
        console.error('Failed to fetch document:', error);
        return undefined;
    }
}
