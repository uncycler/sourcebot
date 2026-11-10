import { expect, test, vi, beforeEach, describe } from 'vitest';
import { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { notAuthenticated } from '../lib/serviceError';
import { getAuthContext, getAuthenticatedUser, withAuth, withOptionalAuth } from './withAuth';
import { MOCK_API_KEY, MOCK_ORG, MOCK_USER_WITH_ACCOUNTS, prisma } from '../__mocks__/prisma';
import { OrgRole } from '@sourcebot/db';
import { ErrorCode } from '../lib/errorCodes';
import { StatusCodes } from 'http-status-codes';
import { runWithRequestContext } from '@/lib/requestContext';

const mocks = vi.hoisted(() => {
    return {
        // Defaults to a empty session.
        auth: vi.fn(async (): Promise<Session | null> => null),
        headers: vi.fn(async (): Promise<Headers> => new Headers()),
        env: {} as Record<string, string>,
    }
});

vi.mock('../auth', () => ({
    auth: mocks.auth,
}));

vi.mock('next/headers', () => ({
    headers: mocks.headers,
}));

vi.mock('@/prisma', async () => {
    // @see: https://github.com/prisma/prisma/discussions/20244#discussioncomment-7976447
    const actual = await vi.importActual<typeof import('@/__mocks__/prisma')>('@/__mocks__/prisma');
    return {
        ...actual,
    };
});

vi.mock('server-only', () => ({
    default: vi.fn(),
}));

vi.mock('@sourcebot/shared', () => ({
    hashSecret: vi.fn((secret: string) => secret),
    API_KEY_PREFIX: 'sbk_',
    LEGACY_API_KEY_PREFIX: 'sourcebot-',
    env: mocks.env,
    createLogger: vi.fn(() => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    })),
}));

// Test utility to set the mock session
const setMockSession = (session: Session | null) => {
    mocks.auth.mockResolvedValue(session);
};

const setMockHeaders = (headers: Headers) => {
    mocks.headers.mockResolvedValue(headers);
};

const SUSPENDED_AT = new Date('2026-01-01T00:00:00.000Z');

// Helper to create mock session objects
const createMockSession = (overrides: Partial<Session> = {}): Session => ({
    user: {
        id: 'test-user-id',
        email: 'test@example.com',
        name: 'Test User',
        image: null,
        ...overrides.user,
    },
    expires: '2099-01-01T00:00:00.000Z',
    ...overrides,
});


beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue(null);
    mocks.headers.mockResolvedValue(new Headers());
    // getAuthContext fires `prisma.user.update().catch(...)` and
    // `prisma.userToOrg.updateMany().catch(...)` to bump lastActiveAt; without a
    // default, the reset mock returns undefined and the .catch chain throws.
    prisma.user.update.mockResolvedValue(MOCK_USER_WITH_ACCOUNTS);
    prisma.userToOrg.updateMany.mockResolvedValue({ count: 0 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
    // Reset env flags between tests
    Object.keys(mocks.env).forEach(key => delete mocks.env[key]);
});

describe('getAuthenticatedUser', () => {
    test('should return a user object if a valid session is present', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));
        const result = await getAuthenticatedUser();
        expect(result).not.toBeUndefined();
        expect(result?.user.id).toBe(userId);
        expect(result?.principal.source).toBe('session');
    });

    test('should return a user object if a valid api key is present', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });

        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));
        const result = await getAuthenticatedUser();
        expect(result).not.toBeUndefined();
        expect(result?.user.id).toBe(userId);
        expect(result?.principal.source).toBe('api_key');
        expect(prisma.apiKey.update).toHaveBeenCalledWith({
            where: {
                hash: 'apikey',
            },
            data: {
                lastUsedAt: expect.any(Date),
            },
        });
    });

    test('should return a user object if a valid api key with the new sbk_ prefix is present', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });

        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sbk_apikey' }));
        const result = await getAuthenticatedUser();
        expect(result).not.toBeUndefined();
        expect(result?.user.id).toBe(userId);
        expect(result?.principal.source).toBe('api_key');
        expect(prisma.apiKey.update).toHaveBeenCalledWith({
            where: { hash: 'apikey' },
            data: { lastUsedAt: expect.any(Date) },
        });
    });

    test('should return a user object if a valid Bearer token is present', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });

        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));
        const result = await getAuthenticatedUser();
        expect(result).not.toBeUndefined();
        expect(result?.user.id).toBe(userId);
        expect(result?.principal.source).toBe('api_key');
        expect(prisma.apiKey.update).toHaveBeenCalledWith({
            where: {
                hash: 'apikey',
            },
            data: {
                lastUsedAt: expect.any(Date),
            },
        });
    });

    test('should use the current request context when no request is passed', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });

        const request = new NextRequest('https://sourcebot.example.com/api/test', {
            headers: {
                Authorization: 'Bearer sourcebot-apikey',
            },
        });

        const result = await runWithRequestContext(request, () => getAuthenticatedUser());

        expect(result).not.toBeUndefined();
        expect(result?.user.id).toBe(userId);
        expect(result?.principal.source).toBe('api_key');
        expect(mocks.headers).not.toHaveBeenCalled();
        expect(prisma.apiKey.update).toHaveBeenCalledWith({
            where: {
                hash: 'apikey',
            },
            data: {
                lastUsedAt: expect.any(Date),
            },
        });
    });

    test('should return undefined if a Bearer token is present but the API key does not exist', async () => {
        prisma.apiKey.findUnique.mockResolvedValue(null);
        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });

    test('should not authenticate OAuth, scoped access, or DPoP tokens', async () => {
        for (const authorization of [
            'Bearer sboa_oauthtoken',
            'Bearer sbst_scopedtoken',
            'DPoP sboa_oauthtoken',
        ]) {
            setMockHeaders(new Headers({ 'Authorization': authorization }));
            const result = await getAuthenticatedUser();
            expect(result).toBeUndefined();
        }
        expect(prisma.apiKey.findUnique).not.toHaveBeenCalled();
    });

    test('should return undefined if a Bearer token is present but the user is not found', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: 'test-user-id',
        });
        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });

    test('should return undefined if no session or api key is present', async () => {
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });

    test('should return undefined if a api key does not exist', async () => {
        prisma.apiKey.findUnique.mockResolvedValue(null);
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });

    test('should return undefined if a api key is present but is invalid', async () => {
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'different-hash',
            createdById: 'test-user-id',
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });

    test('should return undefined if a valid session is present but the user is not found', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });

    test('should return undefined if a valid api key is present but the user is not found', async () => {
        prisma.user.findUnique.mockResolvedValue(null);
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: 'test-user-id',
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));
        const user = await getAuthenticatedUser();
        expect(user).toBeUndefined();
    });
});

describe('getAuthContext', () => {
    test('does not record activity or activate a pending membership when activity recording is disabled', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue(MOCK_ORG);
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        setMockSession(createMockSession({ user: { id: userId } }));

        const authContext = await getAuthContext({ recordActivity: false });

        expect(authContext).toMatchObject({
            user: { id: userId },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
        });
        expect(prisma.user.update).not.toHaveBeenCalled();
        expect(prisma.userToOrg.updateMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    test('should return a auth context object if a valid session is present and the user is a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });

        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));
        const authContext = await getAuthContext();
        expect(authContext).not.toBeUndefined();
        expect(authContext).toStrictEqual({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            prisma,
            principal: { source: 'session' },
        });
    });

    test('should activate a pending member on first request', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.userToOrg.updateMany.mockResolvedValue({ count: 1 });

        setMockSession(createMockSession({ user: { id: userId } }));
        await getAuthContext();

        expect(prisma.userToOrg.updateMany).toHaveBeenCalledWith({
            where: {
                orgId: MOCK_ORG.id,
                userId,
                suspendedAt: null,
                lastActiveAt: null,
            },
            data: { lastActiveAt: expect.any(Date) },
        });
    });

    test('should not fail when another request already marked the member active', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.userToOrg.updateMany.mockResolvedValue({ count: 0 });

        setMockSession(createMockSession({ user: { id: userId } }));
        await getAuthContext();
        await Promise.resolve();

    });

    test('should return a auth context object if a valid session is present and the user is a member of the organization with OWNER role', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });

        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));
        const authContext = await getAuthContext();
        expect(authContext).not.toBeUndefined();
        expect(authContext).toStrictEqual({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            prisma,
            principal: { source: 'session' },
        });
    });

    test('should return a auth context object if a valid session is present and the user is not a member of the organization. The role should be undefined.', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue(null);

        setMockSession(createMockSession({ user: { id: userId } }));
        const authContext = await getAuthContext();
        expect(authContext).not.toBeUndefined();
        expect(authContext).toStrictEqual({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            prisma,
            principal: { source: 'session' },
        });
    });

    test('should return a auth context object if no auth session is present. The role and user should be undefined.', async () => {
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue(null);

        const authContext = await getAuthContext();
        expect(authContext).not.toBeUndefined();
        expect(authContext).toStrictEqual({
            user: undefined,
            org: MOCK_ORG,
            prisma,
            principal: undefined,
        });
    });

    test('should not grant a role when the membership is suspended, even though the membership row exists', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: SUSPENDED_AT,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });

        setMockSession(createMockSession({ user: { id: userId } }));
        const authContext = await getAuthContext();
        expect(authContext).toStrictEqual({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            prisma,
            principal: { source: 'session' },
        });
        expect(prisma.userToOrg.updateMany).not.toHaveBeenCalled();
    });

    test('should not grant a role to a suspended member authenticating via API key (API-key auth bypasses the JWT sessionVersion logout, so this gate is what denies them)', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: SUSPENDED_AT,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

        const authContext = await getAuthContext();
        expect(authContext).toStrictEqual({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            prisma,
            principal: { source: 'api_key' },
        });
    });

    describe('DISABLE_API_KEY_USAGE_FOR_NON_OWNER_USERS', () => {
        test('should return a 403 service error when flag is enabled and a non-owner authenticates via api key', async () => {
            mocks.env.DISABLE_API_KEY_USAGE_FOR_NON_OWNER_USERS = 'true';
            const userId = 'test-user-id';
            prisma.user.findUnique.mockResolvedValue({ ...MOCK_USER_WITH_ACCOUNTS, id: userId });
            prisma.org.findUnique.mockResolvedValue({ ...MOCK_ORG });
            prisma.userToOrg.findUnique.mockResolvedValue({
                joinedAt: new Date(),
                userId,
                orgId: MOCK_ORG.id,
                suspendedAt: null,
                lastActiveAt: null,
                role: OrgRole.MEMBER,
            });
            prisma.apiKey.findUnique.mockResolvedValue({ ...MOCK_API_KEY, hash: 'apikey', createdById: userId });
            setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

            const authContext = await getAuthContext();
            expect(authContext).toStrictEqual({
                statusCode: StatusCodes.FORBIDDEN,
                errorCode: ErrorCode.API_KEY_USAGE_DISABLED,
                message: 'API key usage is disabled for non-admin users.',
            });
        });

        test('should allow an owner to authenticate via api key when flag is enabled', async () => {
            mocks.env.DISABLE_API_KEY_USAGE_FOR_NON_OWNER_USERS = 'true';
            const userId = 'test-user-id';
            prisma.user.findUnique.mockResolvedValue({ ...MOCK_USER_WITH_ACCOUNTS, id: userId });
            prisma.org.findUnique.mockResolvedValue({ ...MOCK_ORG });
            prisma.userToOrg.findUnique.mockResolvedValue({
                joinedAt: new Date(),
                userId,
                orgId: MOCK_ORG.id,
                suspendedAt: null,
                lastActiveAt: null,
                role: OrgRole.OWNER,
            });
            prisma.apiKey.findUnique.mockResolvedValue({ ...MOCK_API_KEY, hash: 'apikey', createdById: userId });
            setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

            const authContext = await getAuthContext();
            expect(authContext).toStrictEqual({
                user: { ...MOCK_USER_WITH_ACCOUNTS, id: userId },
                org: MOCK_ORG,
                role: OrgRole.OWNER,
                prisma,
                principal: { source: 'api_key' },
            });
        });

        test('should allow a non-owner to authenticate via session when flag is enabled', async () => {
            mocks.env.DISABLE_API_KEY_USAGE_FOR_NON_OWNER_USERS = 'true';
            const userId = 'test-user-id';
            prisma.user.findUnique.mockResolvedValue({ ...MOCK_USER_WITH_ACCOUNTS, id: userId });
            prisma.org.findUnique.mockResolvedValue({ ...MOCK_ORG });
            prisma.userToOrg.findUnique.mockResolvedValue({
                joinedAt: new Date(),
                userId,
                orgId: MOCK_ORG.id,
                suspendedAt: null,
                lastActiveAt: null,
                role: OrgRole.MEMBER,
            });
            setMockSession(createMockSession({ user: { id: userId } }));

            const authContext = await getAuthContext();
            expect(authContext).toStrictEqual({
                user: { ...MOCK_USER_WITH_ACCOUNTS, id: userId },
                org: MOCK_ORG,
                role: OrgRole.MEMBER,
                prisma,
                principal: { source: 'session' },
            });
        });
    });

});

describe('withAuth', () => {
    describe('requiredAuthSource', () => {
        test('should call the callback when the authentication source matches', async () => {
            const userId = 'test-user-id';
            prisma.user.findUnique.mockResolvedValue({
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            });
            prisma.org.findUnique.mockResolvedValue({ ...MOCK_ORG });
            prisma.userToOrg.findUnique.mockResolvedValue({
                joinedAt: new Date(),
                userId,
                orgId: MOCK_ORG.id,
                suspendedAt: null,
                lastActiveAt: null,
                role: OrgRole.MEMBER,
            });
            prisma.apiKey.findUnique.mockResolvedValue({
                ...MOCK_API_KEY,
                hash: 'apikey',
                createdById: userId,
            });
            setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));
            const cb = vi.fn(async () => 'allowed');

            const result = await withAuth(cb, { requiredAuthSource: 'api_key' });

            expect(result).toBe('allowed');
            expect(cb).toHaveBeenCalledOnce();
        });

        test('should return forbidden when the authentication source does not match', async () => {
            const userId = 'test-user-id';
            prisma.user.findUnique.mockResolvedValue({
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            });
            prisma.org.findUnique.mockResolvedValue({ ...MOCK_ORG });
            prisma.userToOrg.findUnique.mockResolvedValue({
                joinedAt: new Date(),
                userId,
                orgId: MOCK_ORG.id,
                suspendedAt: null,
                lastActiveAt: null,
                role: OrgRole.MEMBER,
            });
            setMockSession(createMockSession({ user: { id: userId } }));
            const cb = vi.fn(async () => 'allowed');

            const result = await withAuth(cb, { requiredAuthSource: 'api_key' });

            expect(result).toStrictEqual({
                statusCode: StatusCodes.FORBIDDEN,
                errorCode: ErrorCode.INSUFFICIENT_PERMISSIONS,
                message: 'This operation cannot be performed with the current authentication method.',
            });
            expect(cb).not.toHaveBeenCalled();
        });

        test('should return unauthenticated when no authentication source is present', async () => {
            prisma.org.findUnique.mockResolvedValue({ ...MOCK_ORG });
            const cb = vi.fn(async () => 'allowed');

            const result = await withAuth(cb, { requiredAuthSource: 'api_key' });

            expect(result).toStrictEqual(notAuthenticated());
            expect(cb).not.toHaveBeenCalled();
        });
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization with OWNER role', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization (api key)', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization with OWNER role (api key)', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid Bearer token is present and the user is a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid Bearer token is present and the user is a member of the organization with OWNER role', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should return a service error if the user is a member of the organization but does not have a valid session', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        setMockSession(null);

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });

    test('should return a service error if the user is not a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        // user is not a member of the organization
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });

    test('should return a service error when the membership is suspended, even with a valid session', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: SUSPENDED_AT,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        setMockSession(createMockSession({ user: { id: userId } }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });

    test('should deny a suspended member authenticating via API key', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: SUSPENDED_AT,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });
});

describe('withOptionalAuth', () => {
    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization with OWNER role', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization (api key)', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid session is present and the user is a member of the organization with OWNER role (api key)', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'X-Sourcebot-Api-Key': 'sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid Bearer token is present and the user is a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.MEMBER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should call the callback with the auth context object if a valid Bearer token is present and the user is a member of the organization with OWNER role', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.OWNER,
        });
        prisma.apiKey.findUnique.mockResolvedValue({
            ...MOCK_API_KEY,
            hash: 'apikey',
            createdById: userId,
        });
        setMockHeaders(new Headers({ 'Authorization': 'Bearer sourcebot-apikey' }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: MOCK_ORG,
            role: OrgRole.OWNER,
            principal: expect.any(Object),
            prisma,
        });
        expect(result).toEqual(undefined);
    });

    test('should return a service error if the user is a member of the organization but does not have a valid session', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        prisma.userToOrg.findUnique.mockResolvedValue({
            joinedAt: new Date(),
            userId: userId,
            orgId: MOCK_ORG.id,
            suspendedAt: null,
            lastActiveAt: null,
            role: OrgRole.MEMBER,
        });
        setMockSession(null);

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });

    test('should return a service error if the user is not a member of the organization', async () => {
        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
        });
        // user is not a member of the organization
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });

    test('should call the callback with the auth context object if the user is not a member of the organization and anonymous access is enabled', async () => {

        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
            isAnonymousAccessEnabled: true,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).toHaveBeenCalledWith({
            user: {
                ...MOCK_USER_WITH_ACCOUNTS,
                id: userId,
            },
            org: {
                ...MOCK_ORG,
                isAnonymousAccessEnabled: true,
            },
            prisma,
            principal: { source: 'session' },
        });
        expect(result).toEqual(undefined);
    });

    test('should return a service error when anonymous access is disabled', async () => {

        const userId = 'test-user-id';
        prisma.user.findUnique.mockResolvedValue({
            ...MOCK_USER_WITH_ACCOUNTS,
            id: userId,
        });
        prisma.org.findUnique.mockResolvedValue({
            ...MOCK_ORG,
            isAnonymousAccessEnabled: false,
        });
        setMockSession(createMockSession({ user: { id: 'test-user-id' } }));

        const cb = vi.fn();
        const result = await withOptionalAuth(cb);
        expect(cb).not.toHaveBeenCalled();
        expect(result).toStrictEqual(notAuthenticated());
    });
});
