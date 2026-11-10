// Must be the first import: extends zod before any schemas are created.
import './extendZod.js';
import { ConnectionType } from '@sourcebot/db';
import z from 'zod';
import {
    findRelatedSymbolsRequestSchema,
    findRelatedSymbolsResponseSchema,
} from '../features/codeNav/types.js';
import {
    commitAuthorSchema,
    commitDetailSchema,
    commitSchema,
    fileBlameRequestSchema,
    fileBlameResponseSchema,
    fileSourceRequestSchema,
    fileSourceResponseSchema,
    getCommitQueryParamsSchema,
    getDiffRequestSchema,
    getDiffResponseSchema,
    getTreeRequestSchema,
    listCommitAuthorsQueryParamsSchema,
    listCommitsQueryParamsSchema,
} from '../features/git/schemas.js';
import {
    searchRequestSchema,
    searchResponseSchema,
} from '../features/search/types.js';
import { serviceErrorSchema } from '../lib/serviceError.js';
import { getVersionResponseSchema, listReposQueryParamsSchema, listReposResponseSchema } from '../lib/schemas.js';

export const publicServiceErrorSchema = serviceErrorSchema.openapi('PublicApiServiceError', {
    description: 'Structured error response returned by Sourcebot public API endpoints.',
});

export const publicSearchRequestSchema = searchRequestSchema.openapi('PublicSearchRequest');
export const publicSearchResponseSchema = searchResponseSchema.openapi('PublicSearchResponse');
export const publicGetTreeRequestSchema = getTreeRequestSchema.openapi('PublicGetTreeRequest');
export const publicFileSourceRequestSchema = fileSourceRequestSchema.openapi('PublicFileSourceRequest');
export const publicFileSourceResponseSchema = fileSourceResponseSchema.openapi('PublicFileSourceResponse');
export const publicFileBlameRequestSchema = fileBlameRequestSchema.openapi('PublicFileBlameRequest');
export const publicFileBlameResponseSchema = fileBlameResponseSchema.openapi('PublicFileBlameResponse');
export const publicVersionResponseSchema = getVersionResponseSchema.openapi('PublicVersionResponse');
export const publicListConnectionsResponseSchema = z.array(z.object({
    id: z.number().int(),
    name: z.string(),
    connectionType: z.nativeEnum(ConnectionType),
})).openapi('PublicListConnectionsResponse');
export const publicListReposQueryParamsSchema = listReposQueryParamsSchema.openapi('PublicListReposQuery');
export const publicListReposResponseSchema = listReposResponseSchema.openapi('PublicListReposResponse');
export const publicGetDiffRequestSchema = getDiffRequestSchema.openapi('PublicGetDiffRequest');
export const publicGetDiffResponseSchema = getDiffResponseSchema.openapi('PublicGetDiffResponse');
export const publicFindSymbolsRequestSchema = findRelatedSymbolsRequestSchema.openapi('PublicFindSymbolsRequest');
export const publicFindSymbolsResponseSchema = findRelatedSymbolsResponseSchema.openapi('PublicFindSymbolsResponse');
export const publicListCommitsQuerySchema = listCommitsQueryParamsSchema.openapi('PublicListCommitsQuery');
export const publicCommitSchema = commitSchema.openapi('PublicCommit');
export const publicListCommitsResponseSchema = z.array(publicCommitSchema).openapi('PublicListCommitsResponse');
export const publicGetCommitQuerySchema = getCommitQueryParamsSchema.openapi('PublicGetCommitQuery');
export const publicCommitDetailSchema = commitDetailSchema.openapi('PublicCommitDetail');
export const publicListCommitAuthorsQuerySchema = listCommitAuthorsQueryParamsSchema.openapi('PublicListCommitAuthorsQuery');
export const publicCommitAuthorSchema = commitAuthorSchema.openapi('PublicCommitAuthor');
export const publicListCommitAuthorsResponseSchema = z.array(publicCommitAuthorSchema).openapi('PublicListCommitAuthorsResponse');

export const publicHealthResponseSchema = z.object({
    status: z.enum(['ok']),
}).openapi('PublicHealthResponse');
