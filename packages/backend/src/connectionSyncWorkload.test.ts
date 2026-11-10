import type { PrismaClient } from "@sourcebot/db";
import type { RepoData } from "./repoCompileUtils.js";
import type { JobManager, ProcessContext } from "./types.js";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    connectionFindUniqueOrThrow: vi.fn(),
    connectionUpdate: vi.fn(),
    connectionUpdateMany: vi.fn(),
    compileGithubConfig: vi.fn(),
    repoFindMany: vi.fn(),
    repoUpsert: vi.fn(),
    repoToConnectionDeleteMany: vi.fn(),
    getJobSchedulerIds: vi.fn(),
    upsertJobScheduler: vi.fn(),
    removeJobScheduler: vi.fn(),
    logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock("@sourcebot/shared", () => ({
    CONNECTION_QUEUE: {
        name: "connection-sync",
        deduplication: ({ connectionId }: { connectionId: number }) => ({
            id: `connection:${connectionId}`,
        }),
        jobOptions: {
            attempts: 2,
            backoff: { type: "exponential", delayMs: 5000 },
            retention: {
                mode: "window",
                keepJobs: {
                    completed: { count: 50 },
                    failed: { count: 50 },
                },
            },
            keepLogs: 500,
        },
    },
    JOB_PRIORITIES: {
        INITIAL: 5,
        SCHEDULED: 10,
    },
    env: {
        CONFIG_PATH: "/config.json",
        CONNECTION_MANAGER_UPSERT_TIMEOUT_MS: 60_000,
    },
    createLogger: vi.fn(() => mocks.logger),
    repositoryDiscoveryIssueSchema: {
        parse: (issue: unknown) => issue,
    },
}));

vi.mock("./repoCompileUtils.js", () => ({
    compileAzureDevOpsConfig: vi.fn(),
    compileBitbucketConfig: vi.fn(),
    compileGenericGitHostConfig: vi.fn(),
    compileGerritConfig: vi.fn(),
    compileGiteaConfig: vi.fn(),
    compileGithubConfig: mocks.compileGithubConfig,
    compileGitlabConfig: vi.fn(),
}));

import {
    createConnectionSyncWorkload as createConnectionWorkload,
    replaceConnectionRepositories,
    reconcileRepoIndexWork,
} from "./connectionSyncWorkload.js";
import { reportRepositoryDiscoveryIssue } from "./repositoryDiscoveryIssueContext.js";

const db = {
    connection: {
        findUniqueOrThrow: mocks.connectionFindUniqueOrThrow,
        update: mocks.connectionUpdate,
        updateMany: mocks.connectionUpdateMany,
    },
    repo: {
        findMany: mocks.repoFindMany,
        upsert: mocks.repoUpsert,
    },
    repoToConnection: {
        deleteMany: mocks.repoToConnectionDeleteMany,
    },
} as unknown as PrismaClient;

const jobManager = {
    getJobSchedulerIds: mocks.getJobSchedulerIds,
    upsertJobScheduler: mocks.upsertJobScheduler,
    removeJobScheduler: mocks.removeJobScheduler,
} as unknown as JobManager;
const connectionWorkload = createConnectionWorkload({
    db,
    jobManager,
    settings: {
        maxConnectionSyncJobConcurrency: 2,
        reindexIntervalMs: 3_600_000,
    } as never,
});

const data = {
    connectionId: 42,
};

const lifecycleContext = {
    data,
    jobId: "job-1",
    attemptsMade: 0,
    maxAttempts: 2,
    prisma: db,
};

describe("connectionWorkload", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.connectionUpdate.mockResolvedValue({});
        mocks.connectionUpdateMany.mockResolvedValue({ count: 1 });
        mocks.repoFindMany.mockResolvedValue([]);
        mocks.getJobSchedulerIds.mockResolvedValue([]);
        mocks.upsertJobScheduler.mockResolvedValue("scheduled-job");
        mocks.removeJobScheduler.mockResolvedValue(true);
    });

    test("declares the connection lifecycle hooks", () => {
        expect(connectionWorkload.onStarted).toBeTypeOf("function");
        expect(connectionWorkload.onCompleted).toBeTypeOf("function");
        expect(connectionWorkload.onTerminalFailure).toBeTypeOf("function");
    });

    test("uses a distinct execution lock for each connection", () => {
        expect(connectionWorkload.executionLock).toBeDefined();
        expect(
            connectionWorkload.executionLock?.resource({ connectionId: 42 }),
        ).toBe("sourcebot:lock:connection:42");
        expect(
            connectionWorkload.executionLock?.resource({ connectionId: 43 }),
        ).toBe("sourcebot:lock:connection:43");
        expect(connectionWorkload.executionLock?.durationMs).toBe(60_000);
    });

    test("does not start syncing when execution has already been aborted", async () => {
        const controller = new AbortController();
        controller.abort(new Error("Connection execution lock was lost"));

        await expect(
            connectionWorkload.process({
                ...lifecycleContext,
                signal: controller.signal,
                updateProgress: vi.fn(),
                trigger: vi.fn(),
            }),
        ).rejects.toThrow("Connection execution lock was lost");
        expect(mocks.connectionFindUniqueOrThrow).not.toHaveBeenCalled();
    });

    test("records the latest connection sync job ID when started", async () => {
        await connectionWorkload.onStarted?.(lifecycleContext);

        expect(mocks.connectionUpdate).toHaveBeenCalledWith({
            where: {
                id: 42,
            },
            data: {
                latestSyncJobId: "job-1",
            },
        });
    });

    test("records the first successful sync job terminal state", async () => {
        await connectionWorkload.onCompleted?.(lifecycleContext, {
            outcome: "SUCCESS",
        });

        expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 42,
                firstSyncJobFinishedAt: null,
            },
            data: {
                firstSyncJobFinishedAt: expect.any(Date),
            },
        });
    });

    test("records the first failed sync job terminal state", async () => {
        await connectionWorkload.onTerminalFailure?.(
            lifecycleContext,
            new Error("Connection credentials expired"),
        );

        expect(mocks.connectionUpdateMany).toHaveBeenCalledWith({
            where: {
                id: 42,
                firstSyncJobFinishedAt: null,
            },
            data: {
                firstSyncJobFinishedAt: expect.any(Date),
            },
        });
    });

    test("orchestrates discovery, persistence, and repo work reconciliation", async () => {
        const config = {
            type: "github" as const,
        };
        const discoveredRepo = {
            external_id: "repo-4",
            external_codeHostUrl: "https://github.com",
        };
        mocks.connectionFindUniqueOrThrow.mockResolvedValue({
            id: 42,
            name: "github",
            orgId: 7,
            config,
        });
        mocks.compileGithubConfig.mockResolvedValue([discoveredRepo]);
        mocks.repoUpsert.mockResolvedValue({
            id: 4,
            name: "github.com/sourcebot/repo-4",
            indexedAt: null,
        });
        const trigger = vi.fn();
        const updateProgress = vi.fn();

        const result = await connectionWorkload.process({
            ...lifecycleContext,
            signal: new AbortController().signal,
            updateProgress,
            trigger,
        });

        expect(mocks.compileGithubConfig).toHaveBeenCalledWith(
            config,
            42,
            expect.any(AbortSignal),
        );
        expect(mocks.repoUpsert).toHaveBeenCalledOnce();
        expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-4",
            3_600_000,
            { repoId: 4 },
            { priority: 10 },
        );
        expect(trigger).toHaveBeenCalledWith(
            "repo-index",
            {
                repoId: 4,
            },
            { priority: 5 },
        );
        expect(mocks.connectionUpdate).toHaveBeenCalledWith({
            where: { id: 42 },
            data: { syncedAt: expect.any(Date) },
        });
        expect(result).toEqual({ outcome: "SUCCESS" });
        expect(updateProgress).not.toHaveBeenCalled();
    });

    test("returns partial success reasons reported during discovery", async () => {
        const reason = {
            code: "NOT_FOUND_OR_INACCESSIBLE" as const,
            effect: "TARGET_SKIPPED" as const,
            subject: {
                kind: "repository" as const,
                value: "sourcebot-dev/legacy",
            },
            message: "Repository was not found or is inaccessible.",
        };
        mocks.connectionFindUniqueOrThrow.mockResolvedValue({
            id: 42,
            name: "github",
            orgId: 7,
            config: { type: "github" },
        });
        mocks.compileGithubConfig.mockImplementation(async () => {
            reportRepositoryDiscoveryIssue(reason);
            return [];
        });

        await expect(
            connectionWorkload.process({
                ...lifecycleContext,
                signal: new AbortController().signal,
                updateProgress: vi.fn(),
                trigger: vi.fn(),
            }),
        ).resolves.toEqual({
            outcome: "PARTIAL_SUCCESS",
            reasons: [reason],
        });
    });

    test("preserves missing repositories when discovery is incomplete", async () => {
        const reason = {
            code: "ENUMERATION_FAILED" as const,
            effect: "DISCOVERY_INCOMPLETE" as const,
            subject: {
                kind: "organization" as const,
                value: "sourcebot-dev",
            },
            message: "Repository enumeration did not complete.",
        };
        const indexedAt = new Date("2026-07-30T12:00:00.000Z");
        mocks.connectionFindUniqueOrThrow.mockResolvedValue({
            id: 42,
            name: "github",
            orgId: 7,
            config: { type: "github" },
        });
        mocks.compileGithubConfig.mockImplementation(async () => {
            reportRepositoryDiscoveryIssue(reason);
            return [
                {
                    external_id: "repo-1",
                    external_codeHostUrl: "https://github.com",
                },
            ];
        });
        mocks.repoFindMany
            .mockResolvedValueOnce([
                {
                    id: 2,
                    name: "github.com/sourcebot/repo-2",
                    indexedAt,
                },
            ])
            .mockResolvedValueOnce([]);
        mocks.repoUpsert.mockResolvedValue({
            id: 1,
            name: "github.com/sourcebot/repo-1",
            indexedAt,
        });
        const trigger = vi.fn();

        await expect(
            connectionWorkload.process({
                ...lifecycleContext,
                signal: new AbortController().signal,
                updateProgress: vi.fn(),
                trigger,
            }),
        ).resolves.toEqual({
            outcome: "PARTIAL_SUCCESS",
            reasons: [reason],
        });

        expect(mocks.repoToConnectionDeleteMany).not.toHaveBeenCalled();
        expect(mocks.logger.debug).toHaveBeenCalledWith(
            "Preserving repositories omitted from a DISCOVERY_INCOMPLETE result",
            {
                connectionId: 42,
                repositories: [
                    {
                        id: 2,
                        name: "github.com/sourcebot/repo-2",
                    },
                ],
            },
        );
        expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-2",
            3_600_000,
            { repoId: 2 },
            { priority: 10 },
        );
        expect(trigger).not.toHaveBeenCalledWith(
            "repo-cleanup",
            { repoId: 2 },
            expect.anything(),
        );
    });

    test("does not mark the connection synced when repo work reconciliation fails", async () => {
        mocks.connectionFindUniqueOrThrow.mockResolvedValue({
            id: 42,
            name: "github",
            orgId: 7,
            config: { type: "github" },
        });
        mocks.compileGithubConfig.mockResolvedValue([
            {
                external_id: "repo-4",
                external_codeHostUrl: "https://github.com",
            },
        ]);
        mocks.repoUpsert.mockResolvedValue({
            id: 4,
            name: "github.com/sourcebot/repo-4",
            indexedAt: null,
        });
        mocks.upsertJobScheduler.mockRejectedValueOnce(
            new Error("Redis unavailable"),
        );

        await expect(
            connectionWorkload.process({
                ...lifecycleContext,
                signal: new AbortController().signal,
                updateProgress: vi.fn(),
                trigger: vi.fn(),
            }),
        ).rejects.toThrow("Redis unavailable");

        expect(mocks.connectionUpdate).not.toHaveBeenCalled();
    });
});

describe("connectionWorkload repo sync helpers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getJobSchedulerIds.mockResolvedValue([]);
        mocks.upsertJobScheduler.mockResolvedValue("scheduled-job");
        mocks.removeJobScheduler.mockResolvedValue(true);
    });

    test("persists the discovered repository snapshot", async () => {
        const indexedAt = new Date("2026-07-30T12:00:00.000Z");
        const existingRepo = {
            external_id: "repo-1",
            external_codeHostUrl: "https://github.com",
            displayName: "sourcebot/repo-1",
            connections: {
                create: {
                    connectionId: 42,
                },
            },
        };
        const newRepo = {
            external_id: "repo-4",
            external_codeHostUrl: "https://github.com",
            displayName: "sourcebot/repo-4",
            connections: {
                create: {
                    connectionId: 42,
                },
            },
        };
        mocks.repoFindMany
            .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])
            .mockResolvedValueOnce([
                { id: 2, name: "github.com/sourcebot/repo-2" },
            ]);
        mocks.repoUpsert
            .mockResolvedValueOnce({
                id: 1,
                name: "github.com/sourcebot/repo-1",
                indexedAt,
            })
            .mockResolvedValueOnce({
                id: 4,
                name: "github.com/sourcebot/repo-4",
                indexedAt: null,
            });

        const result = await replaceConnectionRepositories({
            db,
            connectionId: 42,
            orgId: 7,
            discoveredRepos: [
                existingRepo,
                newRepo,
                newRepo,
            ] as unknown as RepoData[],
        });

        expect(mocks.repoUpsert).toHaveBeenCalledTimes(2);
        expect(mocks.repoUpsert).toHaveBeenNthCalledWith(1, {
            where: {
                external_id_external_codeHostUrl_orgId: {
                    external_id: "repo-1",
                    external_codeHostUrl: "https://github.com",
                    orgId: 7,
                },
            },
            update: {
                ...existingRepo,
                connections: {
                    createMany: {
                        data: { connectionId: 42 },
                        skipDuplicates: true,
                    },
                },
            },
            create: existingRepo,
            select: {
                id: true,
                name: true,
                indexedAt: true,
            },
        });
        expect(mocks.repoToConnectionDeleteMany).toHaveBeenCalledWith({
            where: {
                connectionId: 42,
                repoId: {
                    in: [2, 3],
                },
            },
        });
        expect(result).toEqual({
            currentRepos: [
                {
                    id: 1,
                    name: "github.com/sourcebot/repo-1",
                    indexedAt,
                },
                {
                    id: 4,
                    name: "github.com/sourcebot/repo-4",
                    indexedAt: null,
                },
            ],
            unindexedRepos: [
                { id: 4, name: "github.com/sourcebot/repo-4" },
            ],
            orphanedRepos: [
                { id: 2, name: "github.com/sourcebot/repo-2" },
            ],
            affectedRepoIds: [1, 4, 2, 3],
        });
    });

    test("reconciles repo indexing schedules and immediate work", async () => {
        const trigger = vi.fn().mockResolvedValue("job");
        const indexedAt = new Date("2026-07-30T12:00:00.000Z");

        await reconcileRepoIndexWork({
            jobManager,
            trigger: trigger as ProcessContext<"connection-sync">["trigger"],
            currentRepos: [
                { id: 1, name: "repo-1", indexedAt },
                { id: 4, name: "repo-4", indexedAt: null },
            ],
            unindexedRepos: [{ id: 4, name: "repo-4" }],
            orphanedRepos: [{ id: 2, name: "repo-2" }],
            intervalMs: 3_600_000,
        });

        expect(mocks.upsertJobScheduler).toHaveBeenNthCalledWith(
            1,
            "repo-index",
            "repo-index-v1-1",
            3_600_000,
            { repoId: 1 },
            { priority: 10 },
        );
        expect(mocks.upsertJobScheduler).toHaveBeenNthCalledWith(
            2,
            "repo-index",
            "repo-index-v1-4",
            3_600_000,
            { repoId: 4 },
            { priority: 10 },
        );
        expect(mocks.removeJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-2",
        );
        expect(trigger).toHaveBeenNthCalledWith(
            1,
            "repo-cleanup",
            {
                repoId: 2,
            },
            { priority: 10 },
        );
        expect(trigger).toHaveBeenNthCalledWith(
            2,
            "repo-index",
            {
                repoId: 4,
            },
            { priority: 5 },
        );
        expect(
            mocks.upsertJobScheduler.mock.invocationCallOrder[1],
        ).toBeLessThan(trigger.mock.invocationCallOrder[0]);
    });
});
