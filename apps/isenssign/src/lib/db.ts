/**
 * Prisma Client 싱글톤 (lazy initialization)
 * Prisma 7 "prisma-client" engine requires adapter.
 * We use @prisma/adapter-pg for PostgreSQL.
 */

// Re-export types for convenience
export type { PrismaClient } from "@/generated/prisma/client";

let _prisma: import("@/generated/prisma/client").PrismaClient | null = null;

/**
 * Get or create the Prisma client instance.
 * Lazy to avoid build-time initialization errors.
 */
export function getPrisma() {
  if (_prisma) return _prisma;

  // Dynamic imports to prevent build-time evaluation
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaClient } = require("@/generated/prisma/client");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PrismaPg } = require("@prisma/adapter-pg");

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  _prisma = new PrismaClient({ adapter });

  return _prisma!;
}

/**
 * Convenience getter (use in API routes)
 */
export const prisma = new Proxy({} as import("@/generated/prisma/client").PrismaClient, {
  get(_target, prop) {
    return (getPrisma() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
