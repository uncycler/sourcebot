import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount, AdapterUser } from "next-auth/adapters";
import { PrismaClient } from "@sourcebot/db";

/**
 * Prisma adapter that remaps the auth.js `provider` field onto our
 * `providerId` column.
 */
export function EncryptedPrismaAdapter(prisma: PrismaClient): Adapter {
    const baseAdapter = PrismaAdapter(prisma);

    return {
        ...baseAdapter,
        async linkAccount(account: AdapterAccount) {
            // This fork has no OAuth / OIDC identity providers, so there is
            // nothing to link.
            throw new Error(`Failed to link account for user id ${account.userId}. Account linking is not supported (provider ${account.provider}).`);
        },
        async getUserByAccount({ provider, providerAccountId }) {
            const account = await prisma.account.findUnique({
                where: {
                    providerId_providerAccountId: {
                        providerId: provider,
                        providerAccountId,
                    },
                },
                include: { user: true },
            });
            // Cast to AdapterUser to satisfy next-auth's adapter return type;
            // the base PrismaAdapter returns the user row directly, and we mirror it.
            return (account?.user ?? null) as AdapterUser | null;
        },
        async unlinkAccount({ provider, providerAccountId }) {
            await prisma.account.delete({
                where: {
                    providerId_providerAccountId: {
                        providerId: provider,
                        providerAccountId,
                    },
                },
            });
        },
    };
}
