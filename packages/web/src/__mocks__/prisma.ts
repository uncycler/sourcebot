import { SINGLE_TENANT_ORG_ID, SINGLE_TENANT_ORG_NAME } from '@/lib/constants';
import { Account, ApiKey, Org, PrismaClient, User } from '@prisma/client';
import { beforeEach } from 'vitest';
import { mockDeep, mockReset } from 'vitest-mock-extended';

beforeEach(() => {
    mockReset(prisma);
});

export const prisma = mockDeep<PrismaClient>();
export const __unsafePrisma = prisma;

export const MOCK_ORG: Org = {
    id: SINGLE_TENANT_ORG_ID,
    name: SINGLE_TENANT_ORG_NAME,
    createdAt: new Date(),
    updatedAt: new Date(),
    isOnboarded: true,
    imageUrl: null,
    memberApprovalRequired: false,
    isCredentialsLoginEnabled: true,
    isEmailCodeLoginEnabled: false,
    loginMessage: null,
    isAnonymousAccessEnabled: false,
    inviteLinkEnabled: false,
    inviteLinkId: null,
}

export const MOCK_API_KEY: ApiKey = {
    name: 'Test API Key',
    hash: 'apikey',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    orgId: 1,
    createdById: '1',
}

export const MOCK_USER_WITH_ACCOUNTS: User & { accounts: Account[] } = {
    id: '1',
    name: 'Test User',
    email: 'test@test.com',
    createdAt: new Date(),
    updatedAt: new Date(),
    hashedPassword: null,
    emailVerified: null,
    lastActiveAt: null,
    image: null,
    sessionVersion: 0,
    accounts: [],
}

