import { OrgRole } from "@sourcebot/db";
import { BannerPriority, type BannerDescriptor, type BannerId } from "./types";
import { RepositorySyncIssuesBanner } from "./repositorySyncIssuesBanner";
import { RepositoryFirstSyncBanner } from "./repositoryFirstSyncBanner";
import { ConnectionSyncIssuesBanner } from "./connectionSyncIssuesBanner";
import { ConnectionFirstSyncBanner } from "./connectionFirstSyncBanner";

export interface BannerContext {
    role: OrgRole | null;
    connectionSyncCounts: {
        firstTimeSyncingCount: number;
        failedCount: number;
        warningCount: number;
    };
    repositorySyncCounts: {
        firstTimeSyncingCount: number;
        failedCount: number;
        warningCount: number;
    };
    dismissals: Partial<Record<BannerId, string>>;
    today: string;
    now: Date;
}

export function resolveActiveBanner(ctx: BannerContext): BannerDescriptor | null {
    const candidates = buildCandidates(ctx)
        .filter((b) => b.audience === 'everyone' || ctx.role === OrgRole.OWNER)
        .filter((b) => !(b.dismissible && ctx.dismissals[b.id] === ctx.today));

    candidates.sort((a, b) => b.priority - a.priority);
    return candidates[0] ?? null;
}

function buildCandidates(ctx: BannerContext): BannerDescriptor[] {
    const banners: BannerDescriptor[] = [];

    if (ctx.connectionSyncCounts.failedCount > 0) {
        banners.push({
            id: 'connectionSyncFailed',
            priority: BannerPriority.CONNECTION_SYNC_FAILED,
            dismissible: true,
            audience: 'owner',
            render: (props) => (
                <ConnectionSyncIssuesBanner
                    {...props}
                    count={ctx.connectionSyncCounts.failedCount}
                    status="failed"
                />
            ),
        });
    }
    if (ctx.connectionSyncCounts.warningCount > 0) {
        banners.push({
            id: 'connectionSyncWarning',
            priority: BannerPriority.CONNECTION_SYNC_WARNING,
            dismissible: true,
            audience: 'owner',
            render: (props) => (
                <ConnectionSyncIssuesBanner
                    {...props}
                    count={ctx.connectionSyncCounts.warningCount}
                    status="warning"
                />
            ),
        });
    }
    if (ctx.connectionSyncCounts.firstTimeSyncingCount > 0) {
        banners.push({
            id: 'connectionFirstSync',
            priority: BannerPriority.CONNECTION_FIRST_SYNC,
            dismissible: true,
            audience: 'owner',
            render: (props) => (
                <ConnectionFirstSyncBanner
                    {...props}
                    initialCounts={ctx.connectionSyncCounts}
                />
            ),
        });
    }

    const {
        firstTimeSyncingCount: repositoryFirstTimeSyncingCount,
        failedCount: repositorySyncFailedCount,
        warningCount: repositorySyncWarningCount,
    } = ctx.repositorySyncCounts;
    if (repositorySyncFailedCount > 0) {
        banners.push({
            id: 'repositorySyncFailed',
            priority: BannerPriority.REPOSITORY_SYNC_FAILED,
            dismissible: true,
            audience: 'owner',
            render: (props) => (
                <RepositorySyncIssuesBanner
                    {...props}
                    failedCount={repositorySyncFailedCount}
                    warningCount={repositorySyncWarningCount}
                />
            ),
        });
    } else if (repositorySyncWarningCount > 0) {
        banners.push({
            id: 'repositorySyncWarning',
            priority: BannerPriority.REPOSITORY_SYNC_WARNING,
            dismissible: true,
            audience: 'owner',
            render: (props) => (
                <RepositorySyncIssuesBanner
                    {...props}
                    failedCount={repositorySyncFailedCount}
                    warningCount={repositorySyncWarningCount}
                />
            ),
        });
    }
    if (repositoryFirstTimeSyncingCount > 0) {
        banners.push({
            id: 'repositoryFirstSync',
            priority: BannerPriority.REPOSITORY_FIRST_SYNC,
            dismissible: true,
            audience: 'owner',
            render: (props) => (
                <RepositoryFirstSyncBanner
                    {...props}
                    initialCounts={ctx.repositorySyncCounts}
                />
            ),
        });
    }

    return banners;
}
