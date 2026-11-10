import { describe, expect, test, vi } from 'vitest';

vi.mock('@auth/prisma-adapter', () => ({
    PrismaAdapter: () => ({}),
}));
vi.mock('@sourcebot/shared', () => ({
    encryptOAuthToken: (value: unknown) => value,
}));

const { EncryptedPrismaAdapter } = await import('./encryptedPrismaAdapter');

describe('EncryptedPrismaAdapter.unlinkAccount', () => {
    test('deletes the account by provider and provider account id', async () => {
        const deleteAccount = vi.fn().mockResolvedValue({});
        const adapter = EncryptedPrismaAdapter({
            account: {
                delete: deleteAccount,
            },
        } as never);

        await adapter.unlinkAccount?.({
            provider: 'github',
            providerAccountId: 'github-user-1',
        });

        expect(deleteAccount).toHaveBeenCalledWith({
            where: {
                providerId_providerAccountId: {
                    providerId: 'github',
                    providerAccountId: 'github-user-1',
                },
            },
        });
    });
});
