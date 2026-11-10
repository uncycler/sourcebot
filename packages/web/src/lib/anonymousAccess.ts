import { env } from "@sourcebot/shared";
import { __unsafePrisma } from "@/prisma";
import { SINGLE_TENANT_ORG_ID } from "./constants";

/**
 * Returns whether unauthenticated users may access the org. The
 * `FORCE_ENABLE_ANONYMOUS_ACCESS` environment variable takes precedence over
 * the org's `isAnonymousAccessEnabled` setting (Settings → Security).
 */
export const isAnonymousAccessEnabled = async () => {
    if (env.FORCE_ENABLE_ANONYMOUS_ACCESS !== undefined) {
        return env.FORCE_ENABLE_ANONYMOUS_ACCESS === 'true';
    }

    const org = await __unsafePrisma.org.findUnique({
        where: { id: SINGLE_TENANT_ORG_ID },
    });

    if (!org) {
        return false;
    }

    return org.isAnonymousAccessEnabled;
}
