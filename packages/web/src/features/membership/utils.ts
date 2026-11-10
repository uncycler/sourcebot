import { OrgRole, Prisma } from "@sourcebot/db";

/**
 * The role a user receives when joining the org via invite, account-request
 * approval, or interactive-login auto-join.
 */
export const DEFAULT_MEMBER_ROLE = OrgRole.OWNER;

/**
 * Matches suspended memberships.
 */
export const suspendedMembershipWhere = (): Prisma.UserToOrgWhereInput => ({
    suspendedAt: { not: null },
});

/**
 * Matches unsuspended memberships, regardless of activity.
 */
export const activeOrPendingMembershipWhere = (): Prisma.UserToOrgWhereInput => ({
    suspendedAt: null,
});

/**
 * Matches pending memberships: unsuspended and never seen.
 */
export const pendingMembershipWhere = (): Prisma.UserToOrgWhereInput => ({
    ...activeOrPendingMembershipWhere(),
    lastActiveAt: null,
});

/**
 * Matches active memberships: unsuspended and seen at least once.
 */
export const activeMembershipWhere = (): Prisma.UserToOrgWhereInput => ({
    ...activeOrPendingMembershipWhere(),
    lastActiveAt: { not: null },
});
