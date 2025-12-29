/**
 * Database client module using Prisma 7 with SQLite adapter.
 * 
 * This module provides a singleton Prisma client instance configured
 * for use with SQLite via the better-sqlite3 adapter.
 * 
 * @module db
 */

import { PrismaClient } from '../prisma/generated/prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import * as path from 'path';

/**
 * Creates a new Prisma client instance configured for SQLite.
 * 
 * @returns A configured PrismaClient instance
 */
function createPrismaClient(): PrismaClient {
    // Use absolute path for fallback database to avoid location issues
    const dbPath = process.env.DATABASE_URL || `file:${path.resolve(__dirname, '../risk-assessments.db')}`;
    
    // Prisma 7 requires a driver adapter for all databases
    const adapter = new PrismaBetterSqlite3({
        url: dbPath,
    });
    return new PrismaClient({ adapter });
}

// Prevent multiple instances of Prisma Client in development
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

/**
 * Singleton Prisma client instance.
 * Uses globalThis to maintain a single instance across hot module reloads in development.
 */
const prisma = globalForPrisma.prisma ?? createPrismaClient();

export default prisma;

// Set the client on globalThis in non-production environments
if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}
