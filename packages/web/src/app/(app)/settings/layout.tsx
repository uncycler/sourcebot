import React from "react"
import { Metadata } from "next"
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isServiceError } from "@/lib/utils";
import { getOrgAccountRequests } from "@/features/membership/actions";
import { ServiceErrorException } from "@/lib/serviceError";
import { OrgRole } from "@prisma/client";
import { env } from "@sourcebot/shared";
import { withAuth } from "@/middleware/withAuth";
import { NavGroup } from "../@sidebar/components/settingsSidebar/nav";

interface LayoutProps {
    children: React.ReactNode;
}

export const metadata: Metadata = {
    title: "Settings",
}

export default async function SettingsLayout(
    props: LayoutProps
) {
    const {
        children
    } = props;

    const session = await auth();
    if (!session) {
        return redirect('/');
    }

    return (
        <>{children}</>
    )
}

export const getSidebarNavGroups = async () =>
    withAuth(async ({ role }) => {
        let numJoinRequests: number | undefined;
        if (role === OrgRole.OWNER) {
            const requests = await getOrgAccountRequests();
            if (isServiceError(requests)) {
                throw new ServiceErrorException(requests);
            }
            numJoinRequests = requests.length;
        }

        const groups: NavGroup[] = [
            {
                label: "Account",
                items: [
                    {
                        title: "General",
                        href: `/settings/general`,
                        icon: "settings" as const,
                    },
                    ...(env.DISABLE_API_KEY_USAGE_FOR_NON_OWNER_USERS === 'false' || role === OrgRole.OWNER ? [
                        {
                            title: "API Keys",
                            href: `/settings/apiKeys`,
                            icon: "key-round" as const,
                        }
                    ] : []),
                ],
            },
        ];

        if (role === OrgRole.OWNER) {
            groups.push({
                label: "Workspace",
                items: [
                    {
                        title: "Security",
                        href: `/settings/security`,
                        icon: "shield" as const,
                    },
                    {
                        title: "Members",
                        isNotificationDotVisible: numJoinRequests !== undefined && numJoinRequests > 0,
                        href: `/settings/members`,
                        icon: "users" as const,
                    },
                    {
                        title: "Connections",
                        href: `/settings/connections`,
                        hrefRegex: `/settings/connections(/[^/]+)?$`,
                        icon: "plug" as const,
                    },
                ],
            });
        }

        return groups.filter(g => g.items.length > 0);
    });
