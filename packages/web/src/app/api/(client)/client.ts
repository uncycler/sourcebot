'use client';

import { ServiceError } from "@/lib/serviceError";
import { GetVersionResponse, ListReposQueryParams, ListReposResponse } from "@/lib/types";
import { isServiceError } from "@/lib/utils";
import {
    SearchRequest,
    SearchResponse,
} from "@/features/search";
import {
    Commit,
    CommitDetail,
    FileBlameRequest,
    FileBlameResponse,
    FileTreeItem,
    GetDiffResult,
    GetFilesRequest,
    GetFilesResponse,
    GetFolderContentsRequest,
    GetTreeRequest,
    GetTreeResponse,
    FileSourceRequest,
    FileSourceResponse,
    ListCommitsQueryParams,
    ListCommitsResponse,
} from "@/features/git";
import type { JobLogs, QueueName } from "@sourcebot/shared";
import type { RepositorySyncCounts } from "@/features/repos/repositorySyncCounts.server";
import type { ConnectionSyncCounts } from "@/features/connections/connectionSyncCounts.server";

export const search = async (body: SearchRequest): Promise<SearchResponse | ServiceError> => {
    const result = await fetch("/api/search", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
        body: JSON.stringify(body),
    }).then(response => response.json());

    if (isServiceError(result)) {
        return result;
    }

    return result as SearchResponse | ServiceError;
}

export const getFileSource = async (queryParams: FileSourceRequest): Promise<FileSourceResponse | ServiceError> => {
    const url = new URL("/api/source", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value.toString());
    }

    const result = await fetch(url, {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        }
    }).then(response => response.json());

    return result as FileSourceResponse | ServiceError;
}

export const listRepos = async (queryParams: ListReposQueryParams): Promise<ListReposResponse | ServiceError> => {
    const url = new URL("/api/repos", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value.toString());
    }

    const result = await fetch(url, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as ListReposResponse | ServiceError;
}

export const getVersion = async (): Promise<GetVersionResponse> => {
    const result = await fetch("/api/version", {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());
    return result as GetVersionResponse;
}

export const getTree = async (body: GetTreeRequest): Promise<GetTreeResponse | ServiceError> => {
    const result = await fetch("/api/tree", {
        method: "POST",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
        body: JSON.stringify(body),
    }).then(response => response.json());
    return result as GetTreeResponse | ServiceError;
}

export const listCommits = async (queryParams: ListCommitsQueryParams): Promise<ListCommitsResponse | ServiceError> => {
    const url = new URL("/api/commits", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== '') {
            url.searchParams.set(key, value.toString());
        }
    }

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    });

    const result = await response.json();
    if (isServiceError(result)) {
        return result;
    }

    const totalCount = parseInt(response.headers.get('X-Total-Count') ?? '0', 10);
    return { commits: result as Commit[], totalCount };
}

export const getCommit = async (queryParams: { repo: string; ref: string }): Promise<CommitDetail | ServiceError> => {
    const url = new URL("/api/commit", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
    }

    const result = await fetch(url, {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as CommitDetail | ServiceError;
}

export const getDiff = async (queryParams: { repo: string; base: string; head: string; path?: string }): Promise<GetDiffResult | ServiceError> => {
    const url = new URL("/api/diff", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
            url.searchParams.set(key, value);
        }
    }

    const result = await fetch(url, {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as GetDiffResult | ServiceError;
}

export const getFolderContents = async (queryParams: GetFolderContentsRequest): Promise<FileTreeItem[] | ServiceError> => {
    const url = new URL("/api/folder_contents", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        url.searchParams.set(key, value);
    }

    const result = await fetch(url, {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as FileTreeItem[] | ServiceError;
}

export const getFileBlame = async (queryParams: FileBlameRequest): Promise<FileBlameResponse | ServiceError> => {
    const url = new URL("/api/blame", window.location.origin);
    for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
            url.searchParams.set(key, value);
        }
    }

    const result = await fetch(url, {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as FileBlameResponse | ServiceError;
}

export const getFiles = async (body: GetFilesRequest): Promise<GetFilesResponse | ServiceError> => {
    const result = await fetch("/api/files", {
        method: "POST",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
        body: JSON.stringify(body),
    }).then(response => response.json());
    return result as GetFilesResponse | ServiceError;
}

export const getRepositorySyncCounts = async (): Promise<RepositorySyncCounts | ServiceError> => {
    const result = await fetch("/api/repository-sync-counts", {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as RepositorySyncCounts | ServiceError;
}

export const getConnectionSyncCounts = async (): Promise<ConnectionSyncCounts | ServiceError> => {
    const result = await fetch("/api/connection-sync-counts", {
        method: "GET",
        headers: {
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
    }).then(response => response.json());

    return result as ConnectionSyncCounts | ServiceError;
}

export const getJobLogs = async (
    queue: QueueName,
    jobId: string,
    signal?: AbortSignal,
): Promise<JobLogs> => {
    const response = await fetch("/api/job-logs", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Sourcebot-Client-Source": "sourcebot-web-client",
        },
        body: JSON.stringify({ queue, jobId }),
        signal,
    });

    if (!response.ok) {
        throw new Error("Failed to load job logs");
    }

    return response.json() as Promise<JobLogs>;
};
