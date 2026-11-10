import { ReactNode } from "react";
import type { OrgRole } from "@sourcebot/db";

export const BannerPriority = {
    CONNECTION_SYNC_FAILED:    48,
    REPOSITORY_SYNC_FAILED:    45,
    CONNECTION_SYNC_WARNING:   18,
    REPOSITORY_SYNC_WARNING:   15,
    CONNECTION_FIRST_SYNC:     14,
    REPOSITORY_FIRST_SYNC:     12,
} as const;

export type BannerId =
    | 'connectionSyncFailed'
    | 'connectionSyncWarning'
    | 'connectionFirstSync'
    | 'repositorySyncFailed'
    | 'repositorySyncWarning'
    | 'repositoryFirstSync';

export interface BannerProps {
    id: BannerId;
    dismissible: boolean;
    role: OrgRole | null;
    now: Date;
}

export interface BannerDescriptor {
    id: BannerId;
    priority: number;
    dismissible: boolean;
    audience: 'everyone' | 'owner';
    render: (props: BannerProps) => ReactNode;
}

export const DISMISS_COOKIE_PREFIX = 'banner_dismissed_';
