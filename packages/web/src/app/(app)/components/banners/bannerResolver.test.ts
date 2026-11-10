import { describe, expect, test, vi } from 'vitest';
import { OrgRole } from '@sourcebot/db';

// Stub the rendered banner components — these tests assert on descriptor
// metadata only (id, priority, etc), so avoiding their React/Next.js import
// chains keeps the suite focused on resolver logic.
vi.mock('./repositorySyncIssuesBanner', () => ({ RepositorySyncIssuesBanner: () => null }));
vi.mock('./repositoryFirstSyncBanner', () => ({ RepositoryFirstSyncBanner: () => null }));
vi.mock('./connectionSyncIssuesBanner', () => ({ ConnectionSyncIssuesBanner: () => null }));
vi.mock('./connectionFirstSyncBanner', () => ({ ConnectionFirstSyncBanner: () => null }));

import { resolveActiveBanner, type BannerContext } from './bannerResolver';

const NOW = new Date('2026-04-21T12:00:00Z');
const TODAY = '2026-04-21';

const makeContext = (overrides: Partial<BannerContext> = {}): BannerContext => ({
    role: OrgRole.OWNER,
    connectionSyncCounts: { firstTimeSyncingCount: 0, failedCount: 0, warningCount: 0 },
    repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 0, warningCount: 0 },
    dismissals: {},
    today: TODAY,
    now: NOW,
    ...overrides,
});

describe('resolveActiveBanner', () => {
    describe('priority ordering', () => {
        test('returns null when no conditions match', () => {
            expect(resolveActiveBanner(makeContext())).toBeNull();
        });

        test('connection sync failures outrank repository sync failures', () => {
            const result = resolveActiveBanner(makeContext({
                connectionSyncCounts: { firstTimeSyncingCount: 0, failedCount: 1, warningCount: 0 },
                repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 1, warningCount: 0 },
            }));
            expect(result?.id).toBe('connectionSyncFailed');
        });
    });

    describe('connection sync issues', () => {
        test('shows failures and warnings as separate banners', () => {
            const failed = resolveActiveBanner(makeContext({
                connectionSyncCounts: { firstTimeSyncingCount: 0, failedCount: 2, warningCount: 3 },
            }));
            expect(failed?.id).toBe('connectionSyncFailed');
            expect(failed?.dismissible).toBe(true);
            expect(failed?.audience).toBe('owner');

            const warning = resolveActiveBanner(makeContext({
                connectionSyncCounts: { firstTimeSyncingCount: 0, failedCount: 2, warningCount: 3 },
                dismissals: { connectionSyncFailed: TODAY },
            }));
            expect(warning?.id).toBe('connectionSyncWarning');
            expect(warning?.dismissible).toBe(true);
        });

        test('hides connection sync issues from members', () => {
            const result = resolveActiveBanner(makeContext({
                role: OrgRole.MEMBER,
                connectionSyncCounts: { firstTimeSyncingCount: 0, failedCount: 1, warningCount: 1 },
            }));
            expect(result).toBeNull();
        });
    });

    describe('connection first sync', () => {
        test('shows first-time syncing connections to owners', () => {
            const result = resolveActiveBanner(makeContext({
                connectionSyncCounts: {
                    firstTimeSyncingCount: 2,
                    failedCount: 0,
                    warningCount: 0,
                },
            }));

            expect(result?.id).toBe('connectionFirstSync');
            expect(result?.dismissible).toBe(true);
            expect(result?.audience).toBe('owner');
        });

        test('hides first-time syncing connections from members', () => {
            const result = resolveActiveBanner(makeContext({
                role: OrgRole.MEMBER,
                connectionSyncCounts: {
                    firstTimeSyncingCount: 2,
                    failedCount: 0,
                    warningCount: 0,
                },
            }));

            expect(result).toBeNull();
        });
    });

    describe('repository sync issues', () => {
        test('shows failures to owners', () => {
            const result = resolveActiveBanner(makeContext({
                repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 2, warningCount: 1 },
            }));
            expect(result?.id).toBe('repositorySyncFailed');
            expect(result?.dismissible).toBe(true);
            expect(result?.audience).toBe('owner');
        });

        test('shows warnings when there are no failures', () => {
            const result = resolveActiveBanner(makeContext({
                repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 0, warningCount: 2 },
            }));
            expect(result?.id).toBe('repositorySyncWarning');
            expect(result?.dismissible).toBe(true);
        });

        test('hides issues from members', () => {
            const result = resolveActiveBanner(makeContext({
                role: OrgRole.MEMBER,
                repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 1, warningCount: 1 },
            }));
            expect(result).toBeNull();
        });

        test('does not let a warning dismissal suppress a later failure', () => {
            const result = resolveActiveBanner(makeContext({
                repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 1, warningCount: 1 },
                dismissals: { repositorySyncWarning: TODAY },
            }));
            expect(result?.id).toBe('repositorySyncFailed');
        });

        test('hides failures dismissed today', () => {
            const result = resolveActiveBanner(makeContext({
                repositorySyncCounts: { firstTimeSyncingCount: 0, failedCount: 1, warningCount: 1 },
                dismissals: { repositorySyncFailed: TODAY },
            }));
            expect(result).toBeNull();
        });
    });

    describe('repository first sync', () => {
        test('shows first-time syncing repositories to owners', () => {
            const result = resolveActiveBanner(makeContext({
                repositorySyncCounts: {
                    firstTimeSyncingCount: 3,
                    failedCount: 0,
                    warningCount: 0,
                },
            }));

            expect(result?.id).toBe('repositoryFirstSync');
            expect(result?.dismissible).toBe(true);
            expect(result?.audience).toBe('owner');
        });

        test('hides first-time syncing repositories from members', () => {
            const result = resolveActiveBanner(makeContext({
                role: OrgRole.MEMBER,
                repositorySyncCounts: {
                    firstTimeSyncingCount: 3,
                    failedCount: 0,
                    warningCount: 0,
                },
            }));

            expect(result).toBeNull();
        });

        test('repository warnings take priority over first-time syncing', () => {
            const result = resolveActiveBanner(makeContext({
                repositorySyncCounts: {
                    firstTimeSyncingCount: 3,
                    failedCount: 0,
                    warningCount: 1,
                },
            }));

            expect(result?.id).toBe('repositorySyncWarning');
        });
    });
});
