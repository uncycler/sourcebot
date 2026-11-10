import 'server-only';
import { env, getDBConnectionString } from "@sourcebot/shared";
import { PrismaClient } from "@sourcebot/db";

// @see: https://authjs.dev/getting-started/adapters/prisma
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const dbConnectionString = getDBConnectionString();

// @NOTE: In actions and routes, prefer the `prisma` instance provided by the auth
// context (`withAuth` / `withOptionalAuth`). Direct use is reserved for code that
// runs outside a request (e.g., initialize.ts).
export const __unsafePrisma = globalForPrisma.prisma || new PrismaClient({
    // @note: this code is evaluated at build time, and will throw exceptions if these env vars are not set.
    // Here we explicitly check if the DATABASE_URL or the individual database variables are set, and only
    ...(dbConnectionString !== undefined ? {
        datasources: {
            db: {
                url: dbConnectionString,
            },
        }
    } : {}),
})
if (env.NODE_ENV !== "production") globalForPrisma.prisma = __unsafePrisma
