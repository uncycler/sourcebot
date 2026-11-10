import { ConfigSettings } from "./types.js";

export const SOURCEBOT_SUPPORT_EMAIL = 'support@sourcebot.dev';

/**
 * @deprecated Use API_KEY_PREFIX instead.
 */
export const LEGACY_API_KEY_PREFIX = 'sourcebot-';

export const API_KEY_PREFIX = 'sbk_';

/**
 * Default settings.
 */
export const DEFAULT_CONFIG_SETTINGS: ConfigSettings = {
    maxFileSize: 2 * 1024 * 1024, // 2MB in bytes
    maxTrigramCount: 20000,
    reindexIntervalMs: 1000 * 60 * 60, // 1 hour
    resyncConnectionIntervalMs: 1000 * 60 * 60 * 24, // 24 hours
    resyncConnectionPollingIntervalMs: 1000 * 1, // 1 second
    reindexRepoPollingIntervalMs: 1000 * 1, // 1 second
    maxConnectionSyncJobConcurrency: 8,
    maxRepoIndexingJobConcurrency: 8,
    maxRepoGarbageCollectionJobConcurrency: 2,
    repoGarbageCollectionGracePeriodMs: 10 * 1000, // 10 seconds
    repoIndexTimeoutMs: 1000 * 60 * 60 * 2, // 2 hours
    enablePublicAccess: false, // deprected, use FORCE_ENABLE_ANONYMOUS_ACCESS instead
}
