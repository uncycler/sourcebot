import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import {
    MetricsRecorder,
    RedisMetricsHistoryProvider,
} from '@bull-board/metrics';
import { PrismaClient } from '@sourcebot/db';
import { createLogger, env, JOB_PRIORITIES } from '@sourcebot/shared';
import express, { Request, Response } from 'express';
import 'express-async-errors';
import type { Redis } from 'ioredis';
import * as http from "http";
import { PromClient } from './promClient.js';
import type { JobManager, Settings } from './types.js';

const logger = createLogger('api');

const workerApiUrl = new URL(env.WORKER_API_URL);
const PORT = Number(workerApiUrl.port) || (workerApiUrl.protocol === "https:" ? 443 : 80);

export class Api {
    private server: http.Server;
    private metricsRecorder: MetricsRecorder;
    private metricsHistoryProvider: RedisMetricsHistoryProvider;

    constructor(
        promClient: PromClient,
        private prisma: PrismaClient,
        private jobManager: JobManager,
        redis: Redis,
        private settings: Settings,
    ) {
        const app = express();
        app.use(express.json());
        app.use(express.urlencoded({ extended: true }));

        const bullBoardAdapter = new ExpressAdapter();
        bullBoardAdapter.setBasePath('/admin/queues');
        const queueAdapters = jobManager
            .getQueues()
            .map(queue => new BullMQAdapter(queue));
        this.metricsHistoryProvider = new RedisMetricsHistoryProvider({
            connection: redis,
        });
        this.metricsRecorder = new MetricsRecorder({
            queues: queueAdapters,
            connection: redis,
            onLatencyError: (error, queueName) => {
                logger.error(
                    `Failed to record BullMQ latency metrics for queue "${queueName}"`,
                    error,
                );
            },
        });
        createBullBoard({
            queues: queueAdapters,
            serverAdapter: bullBoardAdapter,
            options: { historyProvider: this.metricsHistoryProvider },
        });
        app.use('/admin/queues', bullBoardAdapter.getRouter());

        // Prometheus metrics endpoint
        app.use('/metrics', async (_req: Request, res: Response) => {
            res.set('Content-Type', promClient.registry.contentType);
            const metrics = await promClient.registry.metrics();
            res.end(metrics);
        });

        this.server = app.listen(PORT, () => {
            logger.debug(`API server is running on port ${PORT}`);
            logger.debug(`Bull Board is available at ${workerApiUrl.origin}/admin/queues`);
        });
        this.metricsRecorder.start();
    }

    public async dispose() {
        this.metricsRecorder.stop();
        this.metricsHistoryProvider.disconnect();

        return new Promise<void>((resolve, reject) => {
            this.server.close((err) => {
                if (err) reject(err);
                else resolve(undefined);
            });
        });
    }
}

const scheduleAndTriggerRepoIndexing = async ({
    jobManager,
    repoId,
    reindexIntervalMs,
}: {
    jobManager: JobManager;
    repoId: number;
    reindexIntervalMs: number;
}): Promise<string> => {
    await jobManager.upsertJobScheduler(
        "repo-index",
        `repo-index-v1-${repoId}`,
        reindexIntervalMs,
        {
            repoId,
        },
        { priority: JOB_PRIORITIES.SCHEDULED },
    );

    return jobManager.trigger(
        "repo-index",
        {
            repoId,
        },
        { priority: JOB_PRIORITIES.INTERACTIVE },
    );
};
