import type { User as AuthJsUser } from "next-auth";
import { __unsafePrisma } from "@/prisma";
import { OrgRole } from "@sourcebot/db";
import { SINGLE_TENANT_ORG_ID } from "@/lib/constants";
import { isMemberApprovalRequired } from "@sourcebot/shared";
import { DEFAULT_MEMBER_ROLE } from "@/features/membership/utils";
import { isServiceError } from "@/lib/utils";
import { ensureActiveMember } from "@/features/membership/membership.service";
import { logger } from "./logger";

/**
 * Auth-layer hook invoked whenever a new user account is created (NextAuth's
 * `createUser` event, the credentials provider, and SSO). Handles org onboarding:
 * the first user bootstraps the org as OWNER, subsequent users auto-join as
 * members in open self-serve mode, and auto-join is suppressed when member
 * approval is required.
 * Membership writes go through the membership service.
 */
export const onCreateUser = async ({ user }: { user: AuthJsUser }) => {
    if (!user.id) {
        logger.error("User ID is undefined on user creation");
        throw new Error("User ID is undefined on user creation");
    }

    const defaultOrg = await __unsafePrisma.org.findUnique({
        where: {
            id: SINGLE_TENANT_ORG_ID,
        },
        include: {
            members: true,
        }
    });

    if (defaultOrg === null) {
        throw new Error("Default org not found on single tenant user creation");
    }

    // @note when creating a user, there are two cases for when
    // we should be adding them to the single tenant organization.
    //
    // 1. The organization is empty. In this case, we add the
    // user as a member with the OWNER role.
    const isFirstUser = defaultOrg.members.length === 0;
    if (isFirstUser) {
        const result = await ensureActiveMember(SINGLE_TENANT_ORG_ID, user.id, {
            role: OrgRole.OWNER,
        });
        if (isServiceError(result)) {
            throw new Error(`Failed to bootstrap initial owner for user ${user.id}: ${result.message}`);
        }

    }

    // 2. Otherwise, if member approval is disabled, then we add the user
    // as a member with the default role.
    else if (!isMemberApprovalRequired(defaultOrg)) {
        const result = await ensureActiveMember(SINGLE_TENANT_ORG_ID, user.id, {
            role: DEFAULT_MEMBER_ROLE,
        });
        if (isServiceError(result)) {
            logger.warn(`onCreateUser: user ${user.id} was not auto-joined to org ${SINGLE_TENANT_ORG_ID}: ${result.message}`);
            return;
        }
    }
};