import { beforeEach, describe, expect, test, vi } from 'vitest';
import { activatePendingMembership, ensureActiveMember, removeMember, setMemberRole, setMembershipSuspended } from './membership.service';
import { prisma, MOCK_USER_WITH_ACCOUNTS } from '@/__mocks__/prisma';
import { OrgRole, type UserToOrg } from '@sourcebot/db';
import { ErrorCode } from '@/lib/errorCodes';
import { isServiceError } from '@/lib/utils';
import type { ServiceError } from '@/lib/serviceError';

vi.mock('@/prisma', async () => {
    const actual = await vi.importActual<typeof import('@/__mocks__/prisma')>('@/__mocks__/prisma');
    return { ...actual };
});
vi.mock('server-only', () => ({ default: vi.fn() }));
vi.mock('@/features/membership/utils', () => ({
    activeMembershipWhere: () => ({ suspendedAt: null, lastActiveAt: { not: null } }),
    pendingMembershipWhere: () => ({ suspendedAt: null, lastActiveAt: null }),
    unsuspendedMembershipWhere: () => ({ suspendedAt: null }),
}));

const ORG_ID = 1;
const USER_ID = 'user-1';
const SUSPENDED_AT = new Date('2026-01-01T00:00:00.000Z');
const ACTIVE_AT = new Date('2026-01-02T00:00:00.000Z');

const makeMembership = (overrides: Partial<UserToOrg> = {}): UserToOrg => ({
    orgId: ORG_ID,
    userId: USER_ID,
    role: OrgRole.MEMBER,
    joinedAt: new Date(),
    suspendedAt: null,
    lastActiveAt: null,
    ...overrides,
});

const mockUser = { ...MOCK_USER_WITH_ACCOUNTS, id: USER_ID, email: 'user@example.com' };

beforeEach(() => {
    // Run $transaction callbacks against the same deep mock as the tx client.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.$transaction as any).mockImplementation(async (cb: any) => cb(prisma));
});

describe('activatePendingMembership', () => {
    test('activates a pending unsuspended membership with a guarded update', async () => {
        prisma.userToOrg.updateMany.mockResolvedValue({ count: 1 });

        const result = await activatePendingMembership(makeMembership());

        expect(result).toBeNull();
        expect(prisma.userToOrg.updateMany).toHaveBeenCalledWith({
            where: {
                orgId: ORG_ID,
                userId: USER_ID,
                suspendedAt: null,
                lastActiveAt: null,
            },
            data: { lastActiveAt: expect.any(Date) },
        });
    });

    test('does not activate non-pending memberships', async () => {
        expect(await activatePendingMembership(makeMembership({ lastActiveAt: new Date() }))).toBeNull();
        expect(await activatePendingMembership(makeMembership({ suspendedAt: SUSPENDED_AT }))).toBeNull();

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.userToOrg.updateMany).not.toHaveBeenCalled();
    });

    test('returns null when the guarded update does not activate the row', async () => {
        prisma.userToOrg.updateMany.mockResolvedValue({ count: 0 });

        const result = await activatePendingMembership(makeMembership());

        expect(result).toBeNull();
    });
});

describe('ensureActiveMember', () => {
    test('creates a new active membership when none exists', async () => {
        const created = makeMembership();
        prisma.user.findUnique.mockResolvedValue(mockUser);
        prisma.userToOrg.findUnique.mockResolvedValue(null);
        prisma.userToOrg.create.mockResolvedValue(created);

        const result = await ensureActiveMember(ORG_ID, USER_ID, { role: OrgRole.MEMBER });

        expect(isServiceError(result)).toBe(false);
        expect(result).toEqual(created);
        expect(prisma.userToOrg.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ userId: USER_ID, orgId: ORG_ID, role: OrgRole.MEMBER }),
            }),
        );
    });

    test('clears pending invites and account requests on create', async () => {
        prisma.user.findUnique.mockResolvedValue(mockUser);
        prisma.userToOrg.findUnique.mockResolvedValue(null);
        prisma.userToOrg.create.mockResolvedValue(makeMembership());

        await ensureActiveMember(ORG_ID, USER_ID, { role: OrgRole.MEMBER });

        expect(prisma.accountRequest.deleteMany).toHaveBeenCalledWith({ where: { requestedById: USER_ID, orgId: ORG_ID } });
        expect(prisma.invite.deleteMany).toHaveBeenCalledWith({ where: { recipientEmail: mockUser.email, orgId: ORG_ID } });
    });

    test('is an idempotent no-op when an unsuspended membership already exists', async () => {
        const existing = makeMembership({ suspendedAt: null });
        prisma.user.findUnique.mockResolvedValue(mockUser);
        prisma.userToOrg.findUnique.mockResolvedValue(existing);

        const result = await ensureActiveMember(ORG_ID, USER_ID, { role: OrgRole.MEMBER });

        expect(result).toEqual(existing);
        expect(prisma.userToOrg.create).not.toHaveBeenCalled();
    });

    test('reactivates a suspended membership', async () => {
        const existing = makeMembership({ suspendedAt: SUSPENDED_AT });
        const reactivated = makeMembership({ suspendedAt: null });
        prisma.user.findUnique.mockResolvedValue(mockUser);
        prisma.userToOrg.findUnique.mockResolvedValue(existing);
        prisma.userToOrg.update.mockResolvedValue(reactivated);

        const result = await ensureActiveMember(ORG_ID, USER_ID, { role: OrgRole.MEMBER });

        expect(isServiceError(result)).toBe(false);
        expect(result).toEqual(reactivated);
        expect(prisma.userToOrg.create).not.toHaveBeenCalled();
        expect(prisma.userToOrg.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ suspendedAt: null }) }),
        );
    });

    test('errors when the user does not exist', async () => {
        prisma.user.findUnique.mockResolvedValue(null);

        const result = await ensureActiveMember(ORG_ID, USER_ID, { role: OrgRole.MEMBER });

        expect(isServiceError(result)).toBe(true);
        expect(prisma.userToOrg.create).not.toHaveBeenCalled();
    });
});

describe('removeMember', () => {
    test('deletes the membership and revokes sessions + tokens', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership());

        const result = await removeMember(ORG_ID, USER_ID);

        expect(result).toBeNull();
        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { sessionVersion: { increment: 1 } } });
        expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({ where: { createdById: USER_ID, orgId: ORG_ID } });
        expect(prisma.userToOrg.delete).toHaveBeenCalledWith({ where: { orgId_userId: { orgId: ORG_ID, userId: USER_ID } } });
    });

    test('errors when the membership does not exist', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(null);

        const result = await removeMember(ORG_ID, USER_ID);

        expect(isServiceError(result)).toBe(true);
        expect(prisma.userToOrg.delete).not.toHaveBeenCalled();
    });

    test('blocks removing the last active owner', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.OWNER, suspendedAt: null, lastActiveAt: ACTIVE_AT }));
        prisma.userToOrg.count.mockResolvedValue(1);

        const result = await removeMember(ORG_ID, USER_ID);

        expect(isServiceError(result)).toBe(true);
        expect((result as ServiceError).errorCode).toBe(ErrorCode.LAST_OWNER_CANNOT_BE_REMOVED);
        expect(prisma.userToOrg.delete).not.toHaveBeenCalled();
    });

    test('allows removing a pending owner without applying the last-owner guard', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.OWNER, suspendedAt: null, lastActiveAt: null }));
        prisma.userToOrg.count.mockResolvedValue(1);

        const result = await removeMember(ORG_ID, USER_ID);

        expect(result).toBeNull();
        expect(prisma.userToOrg.count).not.toHaveBeenCalled();
        expect(prisma.userToOrg.delete).toHaveBeenCalled();
    });

    test('allows removing an owner when others remain', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.OWNER, suspendedAt: null, lastActiveAt: ACTIVE_AT }));
        prisma.userToOrg.count.mockResolvedValue(2);

        const result = await removeMember(ORG_ID, USER_ID);

        expect(result).toBeNull();
        expect(prisma.userToOrg.delete).toHaveBeenCalled();
    });

    test('reason "left" removes the member', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership());

        const result = await removeMember(ORG_ID, USER_ID, { reason: 'left' });

        expect(result).toBeNull();
    });
});

describe('setMemberRole', () => {
    test('promotes a member to owner', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.MEMBER, lastActiveAt: ACTIVE_AT }));

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.OWNER);

        expect(result).toBeNull();
        expect(prisma.userToOrg.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { role: OrgRole.OWNER } }),
        );
    });

    test('demotes an owner to member when other owners remain', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.OWNER, suspendedAt: null, lastActiveAt: ACTIVE_AT }));
        prisma.userToOrg.count.mockResolvedValue(2);

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.MEMBER);

        expect(result).toBeNull();
    });

    test('blocks demoting the last active owner', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.OWNER, suspendedAt: null, lastActiveAt: ACTIVE_AT }));
        prisma.userToOrg.count.mockResolvedValue(1);

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.MEMBER);

        expect(isServiceError(result)).toBe(true);
        expect((result as ServiceError).errorCode).toBe(ErrorCode.LAST_OWNER_CANNOT_BE_DEMOTED);
        expect(prisma.userToOrg.update).not.toHaveBeenCalled();
    });

    test('promotes a pending member to owner', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.MEMBER, lastActiveAt: null }));

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.OWNER);

        expect(result).toBeNull();
        expect(prisma.userToOrg.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { role: OrgRole.OWNER } }),
        );
    });

    test('demotes a pending owner without applying the last-owner guard', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.OWNER, lastActiveAt: null }));
        prisma.userToOrg.count.mockResolvedValue(1);

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.MEMBER);

        expect(result).toBeNull();
        expect(prisma.userToOrg.count).not.toHaveBeenCalled();
        expect(prisma.userToOrg.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { role: OrgRole.MEMBER } }),
        );
    });

    test('blocks promoting a suspended member', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({
            role: OrgRole.MEMBER,
            suspendedAt: SUSPENDED_AT,
        }));

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.OWNER);

        expect(isServiceError(result)).toBe(true);
        expect((result as ServiceError).errorCode).toBe(ErrorCode.MEMBER_SUSPENDED);
        expect(prisma.userToOrg.update).not.toHaveBeenCalled();
    });

    test('blocks demoting a suspended owner', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({
            role: OrgRole.OWNER,
            suspendedAt: SUSPENDED_AT,
            lastActiveAt: ACTIVE_AT,
        }));

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.MEMBER);

        expect(isServiceError(result)).toBe(true);
        expect((result as ServiceError).errorCode).toBe(ErrorCode.MEMBER_SUSPENDED);
        expect(prisma.userToOrg.update).not.toHaveBeenCalled();
    });

    test('is a no-op when the role is unchanged', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ role: OrgRole.MEMBER }));

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.MEMBER);

        expect(result).toBeNull();
        expect(prisma.userToOrg.update).not.toHaveBeenCalled();
    });

    test('errors when the membership does not exist', async () => {
        prisma.userToOrg.findUnique.mockResolvedValue(null);

        const result = await setMemberRole(ORG_ID, USER_ID, OrgRole.OWNER);

        expect(isServiceError(result)).toBe(true);
        expect(prisma.userToOrg.update).not.toHaveBeenCalled();
    });
});

describe('setMembershipSuspended', () => {
    describe('suspend', () => {
        test('suspends an active member and revokes access', async () => {
            const suspended = makeMembership({ suspendedAt: SUSPENDED_AT });
            prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ suspendedAt: null }));
            prisma.userToOrg.update.mockResolvedValue(suspended);

            const result = await setMembershipSuspended(ORG_ID, USER_ID, true);

            expect(result).toEqual(suspended);
            expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { sessionVersion: { increment: 1 } } });
            expect(prisma.apiKey.deleteMany).toHaveBeenCalledWith({ where: { createdById: USER_ID, orgId: ORG_ID } });
            expect(prisma.userToOrg.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ suspendedAt: expect.any(Date), lastActiveAt: null }) }),
            );
        });

        test('is a no-op when already suspended', async () => {
            const existing = makeMembership({ suspendedAt: SUSPENDED_AT });
            prisma.userToOrg.findUnique.mockResolvedValue(existing);

            const result = await setMembershipSuspended(ORG_ID, USER_ID, true);

            expect(result).toEqual(existing);
            expect(prisma.userToOrg.update).not.toHaveBeenCalled();
            expect(prisma.user.update).not.toHaveBeenCalled();
        });

        test('errors when the membership does not exist', async () => {
            prisma.userToOrg.findUnique.mockResolvedValue(null);

            const result = await setMembershipSuspended(ORG_ID, USER_ID, true);

            expect(isServiceError(result)).toBe(true);
            expect(prisma.userToOrg.update).not.toHaveBeenCalled();
        });
    });

    describe('reactivate', () => {
        test('reactivates a suspended member', async () => {
            const reactivated = makeMembership({ suspendedAt: null });
            prisma.userToOrg.findUnique.mockResolvedValue(makeMembership({ suspendedAt: SUSPENDED_AT }));
            prisma.userToOrg.update.mockResolvedValue(reactivated);

            const result = await setMembershipSuspended(ORG_ID, USER_ID, false);

            expect(result).toEqual(reactivated);
            expect(prisma.userToOrg.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ suspendedAt: null }) }),
            );
        });

        test('is a no-op when already active', async () => {
            const existing = makeMembership({ suspendedAt: null });
            prisma.userToOrg.findUnique.mockResolvedValue(existing);

            const result = await setMembershipSuspended(ORG_ID, USER_ID, false);

            expect(result).toEqual(existing);
            expect(prisma.userToOrg.update).not.toHaveBeenCalled();
        });
    });
});
