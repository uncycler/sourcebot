import { sew } from "@/middleware/sew";
import { ListReposQueryParams, RepositoryQuery } from "@/lib/types";
import { withOptionalAuth } from "@/middleware/withAuth";
import { getBrowsePath } from "@/app/(app)/browse/hooks/utils";
import { env } from "@sourcebot/shared";

export const listRepos = async ({ query, page, perPage, sort, direction, connectionId }: ListReposQueryParams) => sew(() =>
    withOptionalAuth(async ({ org, prisma }) => {
        const skip = (page - 1) * perPage;
        const orderByField = sort === 'pushed' ? 'pushedAt' : 'name';
        const baseUrl = env.AUTH_URL;
        const where = {
            orgId: org.id,
            ...(query ? {
                name: { contains: query, mode: 'insensitive' as const },
            } : {}),
            ...(connectionId !== undefined ? {
                connections: {
                    some: { connectionId },
                },
            } : {}),
        };

        const [repos, totalCount] = await Promise.all([
            prisma.repo.findMany({
                where,
                skip,
                take: perPage,
                orderBy: { [orderByField]: direction },
            }),
            prisma.repo.count({
                where,
            }),
        ]);

        return {
            data: repos.map((repo) => ({
                codeHostType: repo.external_codeHostType,
                repoId: repo.id,
                repoName: repo.name,
                webUrl: `${baseUrl}${getBrowsePath({
                    repoName: repo.name,
                    path: '',
                    pathType: 'tree',
                })}`,
                repoDisplayName: repo.displayName ?? undefined,
                externalWebUrl: repo.webUrl ?? undefined,
                imageUrl: repo.imageUrl ?? undefined,
                indexedAt: repo.indexedAt ?? undefined,
                pushedAt: repo.pushedAt ?? undefined,
                defaultBranch: repo.defaultBranch ?? undefined,
                isFork: repo.isFork,
                isArchived: repo.isArchived,
            } satisfies RepositoryQuery)),
            totalCount,
        };
    })
)
