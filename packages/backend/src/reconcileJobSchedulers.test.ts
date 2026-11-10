import type { PrismaClient } from "@sourcebot/db";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { reconcileJobSchedulers } from "./reconcileJobSchedulers.js";
import type { JobManager } from "./types.js";

const mocks = {
    connectionFindMany: vi.fn(),
    repoFindMany: vi.fn(),
    getJobSchedulerIds: vi.fn(),
    upsertJobScheduler: vi.fn(),
    removeJobScheduler: vi.fn(),
    trigger: vi.fn(),
};

const db = {
    connection: {
        findMany: mocks.connectionFindMany,
    },
    repo: {
        findMany: mocks.repoFindMany,
    },
} as unknown as PrismaClient;

const jobManager = mocks as unknown as JobManager;

describe("reconcileJobSchedulers", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.connectionFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);
        mocks.repoFindMany.mockImplementation(async ({ where }) =>
            where?.isAutoCleanupDisabled === false
                ? []
                : [{ id: 42 }, { id: 84 }],
        );
        mocks.getJobSchedulerIds.mockResolvedValue([]);
        mocks.upsertJobScheduler.mockResolvedValue("scheduled-job");
        mocks.removeJobScheduler.mockResolvedValue(true);
        mocks.trigger.mockResolvedValue("triggered-job");
    });

    test("reconciles connection and repository schedulers", async () => {
        await reconcileJobSchedulers({
            db,
            jobManager,
            settings: {
                resyncConnectionIntervalMs: 86_400_000,
                reindexIntervalMs: 3_600_000,
            },
        });

        expect(mocks.connectionFindMany).toHaveBeenCalledWith({
            select: { id: true },
        });
        expect(mocks.repoFindMany).toHaveBeenCalledWith({
            where: {
                OR: [
                    {
                        connections: {
                            some: {},
                        },
                    },
                    {
                        isAutoCleanupDisabled: true,
                    },
                ],
            },
            select: { id: true },
        });
        expect(mocks.repoFindMany).toHaveBeenCalledWith({
            where: {
                connections: {
                    none: {},
                },
                isAutoCleanupDisabled: false,
            },
            select: { id: true },
        });
        expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
            "connection-sync",
            "connection-sync-v1-1",
            86_400_000,
            { connectionId: 1 },
            { priority: 10 },
        );
        expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-42",
            3_600_000,
            { repoId: 42 },
            { priority: 10 },
        );
    });

    test("removes index schedulers and cleans up orphaned repos", async () => {
        mocks.repoFindMany.mockImplementation(async ({ where }) => {
            if (where?.isAutoCleanupDisabled === false) {
                return [{ id: 84 }];
            }
            return [{ id: 42 }];
        });
        mocks.getJobSchedulerIds.mockImplementation(async (workloadName) =>
            workloadName === "repo-index"
                ? ["repo-index-v1-42", "repo-index-v1-84"]
                : [],
        );

        await reconcileJobSchedulers({
            db,
            jobManager,
            settings: {
                resyncConnectionIntervalMs: 86_400_000,
                reindexIntervalMs: 3_600_000,
            },
        });

        expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-42",
            3_600_000,
            { repoId: 42 },
            { priority: 10 },
        );
        expect(mocks.upsertJobScheduler).not.toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-84",
            expect.anything(),
            expect.anything(),
            expect.anything(),
        );
        expect(mocks.removeJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-84",
        );
        expect(mocks.trigger).toHaveBeenCalledWith(
            "repo-cleanup",
            { repoId: 84 },
            { priority: 10 },
        );
        expect(
            mocks.removeJobScheduler.mock.invocationCallOrder[0],
        ).toBeLessThan(mocks.trigger.mock.invocationCallOrder[0]);
    });

    test("keeps index schedulers for repos with automatic cleanup disabled", async () => {
        mocks.repoFindMany.mockImplementation(async ({ where }) => {
            if (where?.isAutoCleanupDisabled === false) {
                return [];
            }
            return [{ id: 42 }, { id: 84 }];
        });
        mocks.getJobSchedulerIds.mockImplementation(async (workloadName) =>
            workloadName === "repo-index" ? ["repo-index-v1-84"] : [],
        );

        await reconcileJobSchedulers({
            db,
            jobManager,
            settings: {
                resyncConnectionIntervalMs: 86_400_000,
                reindexIntervalMs: 3_600_000,
            },
        });

        expect(mocks.upsertJobScheduler).toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-84",
            3_600_000,
            { repoId: 84 },
            { priority: 10 },
        );
        expect(mocks.removeJobScheduler).not.toHaveBeenCalledWith(
            "repo-index",
            "repo-index-v1-84",
        );
    });
});
