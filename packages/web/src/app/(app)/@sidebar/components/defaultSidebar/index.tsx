import { auth } from "@/auth";
import { getOrgAccountRequests } from "@/features/membership/actions";
import { isServiceError } from "@/lib/utils";
import { ServiceErrorException } from "@/lib/serviceError";
import { OrgRole } from "@prisma/client";
import { SidebarBase } from "@/app/(app)/@sidebar/components/sidebarBase";
import { Nav } from "./nav";
import { RepoVisitHistory } from "./repoVisitHistory";
import { getAuthContext, withAuth } from "@/middleware/withAuth";
import { sew } from "@/middleware/sew";

export const SIDEBAR_REPO_VISITS_LIMIT = 10;

export async function DefaultSidebar() {
    const session = await auth();
    const repoVisits = session ? await getRecentRepoVisits() : [];
    if (isServiceError(repoVisits)) {
        throw new ServiceErrorException(repoVisits);
    }

    const authContext = await getAuthContext();
    const isOwner = !isServiceError(authContext) && authContext.role === OrgRole.OWNER;

    const isSettingsNotificationVisible = await (async () => {
        if (!isOwner) {
            return false;
        }
        const joinRequests = await getOrgAccountRequests();
        const hasJoinRequestNotification = !isServiceError(joinRequests) && joinRequests.length > 0;
        return hasJoinRequestNotification;
    })();

    return (
        <SidebarBase
            session={session}
            collapsible="icon"
            headerContent={
                <Nav
                    isSettingsNotificationVisible={isSettingsNotificationVisible}
                    isSignedIn={!!session}
                />
            }
        >
            <RepoVisitHistory repoVisits={repoVisits} />
        </SidebarBase>
    );
}

const getRecentRepoVisits = async () => sew(() =>
    withAuth(async ({ org, user, prisma }) => {
        const visits = await prisma.repoVisit.findMany({
            where: {
                userId: user.id,
                orgId: org.id,
            },
            orderBy: {
                lastPromotedAt: 'desc',
            },
            take: SIDEBAR_REPO_VISITS_LIMIT,
            include: {
                repo: {
                    select: {
                        id: true,
                        name: true,
                        displayName: true,
                        imageUrl: true,
                        external_codeHostType: true,
                    },
                },
            },
        });

        return visits.map((visit) => ({
            repoId: visit.repo.id,
            repoName: visit.repo.name,
            displayName: visit.repo.displayName,
            imageUrl: visit.repo.imageUrl,
            codeHostType: visit.repo.external_codeHostType,
        }));
    })
);
