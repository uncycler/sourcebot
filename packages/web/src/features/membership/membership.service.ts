import 'server-only';

import { activeMembershipWhere, pendingMembershipWhere } from "@/features/membership/utils";
import { notFound, type ServiceError } from "@/lib/serviceError";
import { __unsafePrisma as prisma } from "@/prisma";
import { OrgRole, Prisma, type UserToOrg } from "@sourcebot/db";
import { lastOwnerDemoteError, lastOwnerError, memberSuspendedError } from "./errors";

export interface EnsureActiveMemberOptions {
    role: OrgRole;
}

/**
 * Moves an unsuspended pending membership into the active state on the user's
 * first authenticated request.
 */
export const activatePendingMembership = async (
    membership: UserToOrg,
): Promise<ServiceError | null> => {
    if (membership.suspendedAt !== null || membership.lastActiveAt !== null) {
        return null;
    }

    await prisma.userToOrg.updateMany({
        where: {
            orgId: membership.orgId,
            userId: membership.userId,
            ...pendingMembershipWhere(),
        },
        data: { lastActiveAt: new Date() },
    });

    return null;
};

/**
 * Ensures the user has an unsuspended membership. Unsuspended: returned
 * unchanged. Suspended: reactivated. Otherwise: created. `role` only applies
 * on create. Clears pending invites / account requests for the user.
 */
export const ensureActiveMember = async (
    orgId: number,
    userId: string,
    options: EnsureActiveMemberOptions,
): Promise<UserToOrg | ServiceError> => {
    const { role } = options;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        return notFound("User not found");
    }

    const existing = await prisma.userToOrg.findUnique({
        where: { orgId_userId: { orgId, userId } },
    });

    if (existing && existing.suspendedAt === null) {
        return existing;
    }
    if (existing && existing.suspendedAt !== null) {
        return setMembershipSuspended(orgId, userId, false);
    }

    return prisma.$transaction(async (tx) => {
        const created = await tx.userToOrg.create({
            data: {
                userId,
                orgId,
                role,
            },
        });

        await tx.accountRequest.deleteMany({
            where: { requestedById: userId, orgId },
        });
        await tx.invite.deleteMany({
            where: { recipientEmail: user.email, orgId },
        });

        return created;
    });
};

export interface RemoveMemberOptions {
    reason?: "removed" | "left";
}

/**
 * Hard-removes a membership (deletes the join row, preserving the `User`).
 * Bumps `sessionVersion` and revokes the user's API keys + OAuth tokens.
 */
export const removeMember = async (
    orgId: number,
    userId: string,
    options: RemoveMemberOptions = {},
): Promise<ServiceError | null> => {
    const { reason = "removed" } = options;

    const result = await prisma.$transaction(async (tx) => {
        const target = await tx.userToOrg.findUnique({
            where: { orgId_userId: { orgId, userId } },
        });
        if (!target) {
            return notFound("Member not found in this organization");
        }

        if (isActiveOwner(target)) {
            if ((await countActiveOwners(tx, orgId)) <= 1) {
                return lastOwnerError(reason);
            }
        }

        await revokeAllUserAuthCredentials(tx, userId, orgId);

        await tx.userToOrg.delete({
            where: { orgId_userId: { orgId, userId } },
        });

        return null;
    });

    return result;
};

/**
 * Changes a member's role (no-op when unchanged). Pending members can be
 * promoted or demoted so an owner can be lined up before they first sign in;
 * suspended members cannot. No session/token revocation: role is resolved from
 * the DB on every request, so a change takes effect on the member's next
 * request.
 */
export const setMemberRole = async (
    orgId: number,
    userId: string,
    role: OrgRole,
): Promise<ServiceError | null> => {
    const result = await prisma.$transaction(async (tx) => {
        const target = await tx.userToOrg.findUnique({
            where: { orgId_userId: { orgId, userId } },
        });
        if (!target) {
            return notFound("Member not found in this organization");
        }

        if (target.role === role) {
            return null;
        }

        if (target.suspendedAt !== null) {
            return memberSuspendedError();
        }

        const isDemotionFromOwner = target.role === OrgRole.OWNER && role !== OrgRole.OWNER;
        if (isDemotionFromOwner && isActiveOwner(target)) {
            if ((await countActiveOwners(tx, orgId)) <= 1) {
                return lastOwnerDemoteError();
            }
        }

        await tx.userToOrg.update({
            where: { orgId_userId: { orgId, userId } },
            data: { role },
        });

        return null;
    });

    return result;
};

/**
 * Suspends or restores a membership without deleting it. Suspension bumps
 * `sessionVersion` + revokes tokens. A no-op when already in the requested
 * state.
 */
export const setMembershipSuspended = async (
    orgId: number,
    userId: string,
    suspended: boolean,
): Promise<ServiceError | UserToOrg> => {
    if (suspended) {

        const result = await prisma.$transaction(async (tx) => {
            let target = await tx.userToOrg.findUnique({
                where: { orgId_userId: { orgId, userId } },
            });
            if (!target) {
                return notFound("Member not found in this organization");
            }
            if (target.suspendedAt !== null) {
                return target;
            }

            await revokeAllUserAuthCredentials(tx, userId, orgId);

            target = await tx.userToOrg.update({
                where: { orgId_userId: { orgId, userId } },
                data: {
                    suspendedAt: new Date(),
                    // @note: when a user is suspended, reset the lastActiveAt
                    // s.t., if they are restored, they will be in the
                    // "pending" state rather than "active".
                    lastActiveAt: null,
                },
            });
            return target;
        });

        return result;

    } else {

        const result = await prisma.$transaction(async (tx) => {
            let target = await tx.userToOrg.findUnique({
                where: { orgId_userId: { orgId, userId } },
            });
            if (!target) {
                return notFound("Member not found in this organization");
            }

            if (target.suspendedAt === null) {
                return target;
            }

            target = await tx.userToOrg.update({
                where: { orgId_userId: { orgId, userId } },
                data: {
                    suspendedAt: null,
                },
            });
            return target;
        });

        return result;
    }
};

// Pending owners have never signed in and are excluded from `countActiveOwners`,
// so the last-owner guards only apply when the target itself is an active owner.
// Otherwise removing or demoting a pending owner would be blocked by the actor's
// own membership being the only active one counted.
const isActiveOwner = (membership: UserToOrg): boolean =>
    membership.role === OrgRole.OWNER
    && membership.suspendedAt === null
    && membership.lastActiveAt !== null;

const countActiveOwners = (tx: Prisma.TransactionClient, orgId: number): Promise<number> =>
    tx.userToOrg.count({
        where: {
            orgId,
            ...activeMembershipWhere(),
            role: OrgRole.OWNER,
        },
    });

const revokeAllUserAuthCredentials = async (
    prisma: Prisma.TransactionClient,
    userId: string,
    orgId: number,
): Promise<void> => {
    // JWT token
    await prisma.user.update({
        where: { id: userId },
        data: { sessionVersion: { increment: 1 } },
    });

    // API Keys
    await prisma.apiKey.deleteMany({
        where: {
            createdById: userId,
            orgId,
        }
    });
};
