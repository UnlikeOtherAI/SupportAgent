import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as typeof globalThis & {
  supportAgentWorkerPrisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.supportAgentWorkerPrisma ??
  new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.supportAgentWorkerPrisma = prisma;
}
