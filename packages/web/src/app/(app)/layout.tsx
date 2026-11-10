import { __unsafePrisma } from "@/prisma";
import { auth } from "@/auth";
import { isServiceError } from "@/lib/utils";
import { SINGLE_TENANT_ORG_ID } from "@/lib/constants";
import { OnboardGuard } from "./components/onboardGuard";
import { cookies, headers } from "next/headers";
import { getSelectorsByUserAgent } from "react-device-detect";
import { MobileUnsupportedSplashScreen } from "./components/mobileUnsupportedSplashScreen";
import { MOBILE_UNSUPPORTED_SPLASH_SCREEN_DISMISSED_COOKIE_NAME } from "@/lib/constants";
import { SyntaxReferenceGuide } from "./components/syntaxReferenceGuide";
import { SyntaxGuideProvider } from "./components/syntaxGuideProvider";
import { notFound, redirect } from "next/navigation";
import { PendingApprovalCard } from "../../features/membership/components/pendingApprovalCard";
import { SubmitJoinRequestCard } from "../../features/membership/components/submitJoinRequestCard";
import { isMemberApprovalRequired } from "@sourcebot/shared";
import { isAnonymousAccessEnabled } from "@/lib/anonymousAccess";
import { JoinOrganizationCard } from "@/features/membership/components/joinOrganizationCard";
import { GitHubStarToast } from "./components/githubStarToast";
import { BannerSlot } from "./components/banners/bannerSlot";
import { BannerHeightObserver } from "./components/banners/bannerHeightObserver";
import { activeOrPendingMembershipWhere } from "@/features/membership/utils";
import { OrgRole } from "@sourcebot/db";
import { ServiceErrorException } from "@/lib/serviceError";
import { SidebarProvider } from "@/components/ui/sidebar";
import { RoleProvider } from "@/features/auth/roleProvider";
import { NavigationGuardProvider } from "next-navigation-guard";
import { getRepositorySyncCounts } from "@/features/repos/repositorySyncCounts.server";
import { getConnectionSyncCounts } from "@/features/connections/connectionSyncCounts.server";

interface LayoutProps {
    children: React.ReactNode;
    sidebar: React.ReactNode;
}

export default async function Layout(props: LayoutProps) {
    const {
        children,
        sidebar,
    } = props;

    const org = await __unsafePrisma.org.findUnique({
        where: { id: SINGLE_TENANT_ORG_ID },
    });

    if (!org) {
        return notFound();
    }

    const session = await auth();
    const anonymousAccessEnabled = await isAnonymousAccessEnabled();

    let role: OrgRole | null = null;

    // If the user is authenticated, we must check if they're a member of the org
    if (session) {
        const membership = await __unsafePrisma.userToOrg.findUnique({
            where: {
                orgId_userId: {
                    orgId: org.id,
                    userId: session.user.id,
                },
                ...activeOrPendingMembershipWhere(),
            },
            include: {
                user: true
            }
        });

        // A signed-in user might not be a member of the org yet:
        // 1. The org doesn't require member approval. In this case, we show them the join organization card.
        // 2. The org requires member approval, and they haven't been approved yet. In this case, we allow them to submit a request to join the org.
        if (!membership) {
            if (!isMemberApprovalRequired(org)) {
                return <JoinOrganizationCard />;
            }

            const hasPendingApproval = await __unsafePrisma.accountRequest.findFirst({
                where: {
                    orgId: org.id,
                    requestedById: session.user.id
                }
            });

            if (hasPendingApproval) {
                return <PendingApprovalCard />
            } else {
                return <SubmitJoinRequestCard />
            }
        }

        role = membership.role;
    } else {
        // If the user isn't authenticated and anonymous access isn't enabled, we need to redirect them to the login page.
        if (!anonymousAccessEnabled) {
            redirect('/login');
        }
    }

    // If the org is not onboarded, show the onboarding page
    if (!org.isOnboarded) {
        return (
            <OnboardGuard>
                {children}
            </OnboardGuard>
        )
    }

    const headersList = await headers();
    const cookieStore = await cookies()
    const userAgent = headersList.get('user-agent');
    const { isMobile } = userAgent ? getSelectorsByUserAgent(userAgent) : { isMobile: false };

    if (isMobile && !cookieStore.has(MOBILE_UNSUPPORTED_SPLASH_SCREEN_DISMISSED_COOKIE_NAME)) {
        return (
            <MobileUnsupportedSplashScreen />
        )
    }
    const repositorySyncCountsResult = role === OrgRole.OWNER
        ? await getRepositorySyncCounts().catch((error) => {
              console.error("Failed to load repository sync counts", error);
              return {
                  firstTimeSyncingCount: 0,
                  failedCount: 0,
                  warningCount: 0,
              };
          })
        : { firstTimeSyncingCount: 0, failedCount: 0, warningCount: 0 };
    if (isServiceError(repositorySyncCountsResult)) {
        throw new ServiceErrorException(repositorySyncCountsResult);
    }
    const repositorySyncCounts = repositorySyncCountsResult;
    const connectionSyncCountsResult = role === OrgRole.OWNER
        ? await getConnectionSyncCounts().catch((error) => {
              console.error("Failed to load connection sync counts", error);
              return {
                  firstTimeSyncingCount: 0,
                  failedCount: 0,
                  warningCount: 0,
              };
          })
        : { firstTimeSyncingCount: 0, failedCount: 0, warningCount: 0 };
    if (isServiceError(connectionSyncCountsResult)) {
        throw new ServiceErrorException(connectionSyncCountsResult);
    }
    const connectionSyncCounts = connectionSyncCountsResult;

    return (
        <RoleProvider role={role}>
            <SyntaxGuideProvider>
                {/* Keep one guard provider above both sidebar and content so browser history is tracked before guarded routes mount. */}
                <NavigationGuardProvider>
                    <div className="fixed inset-0 flex bg-shell">
                        <SidebarProvider defaultOpen={cookieStore.get("sidebar_state")?.value !== "false"}>
                            {sidebar}
                            <div className="flex-1 min-h-0 min-w-0 flex flex-col pt-2 pb-2 pr-2 pl-2 md:pl-0">
                                <div className="flex-1 min-h-0 bg-background flex flex-col border border-[#e6e6e6] dark:border-[#1d1d1f] rounded-xl overflow-hidden">
                                    <BannerHeightObserver>
                                        <BannerSlot
                                            role={role}
                                            connectionSyncCounts={connectionSyncCounts}
                                            repositorySyncCounts={repositorySyncCounts}
                                        />
                                    </BannerHeightObserver>
                                    <div className="flex-1 min-h-0 overflow-y-scroll [scrollbar-gutter:stable]">
                                        {children}
                                    </div>
                                </div>
                            </div>
                        </SidebarProvider>
                    </div>
                    <SyntaxReferenceGuide />
                    <GitHubStarToast />
                </NavigationGuardProvider>
            </SyntaxGuideProvider>
        </RoleProvider>
    )
}
