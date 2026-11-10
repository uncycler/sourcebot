import { OpenApiGeneratorV3, OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import type { ComponentsObject, SchemaObject, SecuritySchemeObject } from 'openapi3-ts/oas30';
import { type ZodTypeAny } from 'zod';
import {
    publicFileBlameRequestSchema,
    publicFileBlameResponseSchema,
    publicFileSourceRequestSchema,
    publicFileSourceResponseSchema,
    publicFindSymbolsRequestSchema,
    publicFindSymbolsResponseSchema,
    publicGetDiffRequestSchema,
    publicGetDiffResponseSchema,
    publicGetTreeRequestSchema,
    publicHealthResponseSchema,
    publicCommitDetailSchema,
    publicGetCommitQuerySchema,
    publicListCommitAuthorsQuerySchema,
    publicListCommitAuthorsResponseSchema,
    publicListCommitsQuerySchema,
    publicListCommitsResponseSchema,
    publicListConnectionsResponseSchema,
    publicListReposQueryParamsSchema,
    publicListReposResponseSchema,
    publicSearchRequestSchema,
    publicSearchResponseSchema,
    publicServiceErrorSchema,
    publicVersionResponseSchema,
} from './publicApiSchemas.js';
import dedent from 'dedent';

const searchTag = { name: 'Search & Navigation', description: 'Code search and symbol navigation endpoints.' };
const connectionsTag = { name: 'Connections', description: 'Code host connection metadata.' };
const reposTag = { name: 'Repositories', description: 'Repository listing and metadata endpoints.' };
const gitTag = { name: 'Git', description: 'Git history, diff, and file content endpoints.' };
const systemTag = { name: 'System', description: 'System health and version endpoints.' };

const publicFileTreeNodeSchema: SchemaObject = {
    type: 'object',
    properties: {
        type: { type: 'string' },
        path: { type: 'string' },
        name: { type: 'string' },
        children: {
            type: 'array',
            items: { $ref: '#/components/schemas/PublicFileTreeNode' },
        },
    },
    required: ['type', 'path', 'name', 'children'],
    additionalProperties: false,
};

const publicGetTreeResponseSchema: SchemaObject = {
    type: 'object',
    properties: {
        tree: { $ref: '#/components/schemas/PublicFileTreeNode' },
    },
    required: ['tree'],
    additionalProperties: false,
};

const securitySchemeNames = {
    bearerToken: 'bearerToken',
    apiKeyHeader: 'apiKeyHeader',
} as const;

const securitySchemes: Record<keyof typeof securitySchemeNames, SecuritySchemeObject> = {
    [securitySchemeNames.bearerToken]: {
        type: 'http',
        scheme: 'bearer',
        description: 'Bearer authentication header of the form `Bearer <token>`. The token must be a Sourcebot API key.',
    },
    [securitySchemeNames.apiKeyHeader]: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Sourcebot-Api-Key',
        description: 'Header of the form `X-Sourcebot-Api-Key: <token>`, where `<token>` is your API key.',
    },
};

function jsonContent(schema: ZodTypeAny | SchemaObject) {
    return {
        'application/json': {
            schema,
        },
    };
}

function errorJson(description: string) {
    return {
        description,
        content: jsonContent(publicServiceErrorSchema),
    };
}

export function createPublicOpenApiDocument(version: string) {
    const registry = new OpenAPIRegistry();

    registry.registerPath({
        method: 'post',
        path: '/api/search',
        operationId: 'search',
        tags: [searchTag.name],
        summary: 'Search code',
        description: 'Executes a blocking code search and returns all matching file chunks.',
        request: {
            body: {
                required: true,
                content: jsonContent(publicSearchRequestSchema),
            },
        },
        responses: {
            200: {
                description: 'Search results.',
                content: jsonContent(publicSearchResponseSchema),
            },
            400: errorJson('Invalid request body.'),
            500: errorJson('Unexpected search failure.'),
        },
        'x-mint': {
            content: dedent`
                ## Usage
                
                The \`query\` field supports literal, regexp, and symbol searches with filters for repository, file, language, branch, and more. See the [search syntax reference](https://docs.sourcebot.dev/docs/features/search/syntax-reference) for the full query language.
                `,
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/repos',
        operationId: 'listRepositories',
        tags: [reposTag.name],
        summary: 'List repositories',
        description: 'Returns a paginated list of repositories indexed by this Sourcebot instance.',
        request: {
            query: publicListReposQueryParamsSchema,
        },
        responses: {
            200: {
                description: 'Paginated repository list.',
                headers: {
                    'X-Total-Count': {
                        description: 'Total number of repositories matching the query across all pages.',
                        schema: {
                            type: 'integer',
                            example: 137,
                        },
                    },
                    Link: {
                        description: 'Pagination links formatted per RFC 8288. Includes `rel=\"next\"`, `rel=\"prev\"`, `rel=\"first\"`, and `rel=\"last\"` when applicable.',
                        schema: {
                            type: 'string',
                            example: '</api/repos?page=2&perPage=30>; rel="next", </api/repos?page=5&perPage=30>; rel="last"',
                        },
                    },
                },
                content: jsonContent(publicListReposResponseSchema),
            },
            400: errorJson('Invalid query parameters.'),
            500: errorJson('Unexpected repository listing failure.'),
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/connections',
        operationId: 'listConnections',
        tags: [connectionsTag.name],
        summary: 'List connections',
        description: 'Returns unique code host connections associated with at least one repository visible to the caller. Connection configuration and credentials are never included.',
        responses: {
            200: {
                description: 'Connections associated with visible repositories.',
                content: jsonContent(publicListConnectionsResponseSchema),
            },
            401: errorJson('Authentication is required when anonymous access is disabled.'),
            500: errorJson('Unexpected connection listing failure.'),
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/version',
        operationId: 'getVersion',
        tags: [systemTag.name],
        summary: 'Get Sourcebot version',
        description: 'Returns the currently running Sourcebot version string.',
        responses: {
            200: {
                description: 'Current Sourcebot version.',
                content: jsonContent(publicVersionResponseSchema),
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/health',
        operationId: 'getHealth',
        tags: [systemTag.name],
        summary: 'Health check',
        responses: {
            200: {
                description: 'Service is healthy.',
                content: jsonContent(publicHealthResponseSchema),
            },
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/source',
        operationId: 'getFileSource',
        tags: [gitTag.name],
        summary: 'Get file contents',
        description: 'Returns the raw source content of a file at a given repository path and optional git ref.',
        request: {
            query: publicFileSourceRequestSchema,
        },
        responses: {
            200: {
                description: 'File source and metadata.',
                content: jsonContent(publicFileSourceResponseSchema),
            },
            400: errorJson('Invalid query parameters or git ref.'),
            404: errorJson('Repository or file not found.'),
            500: errorJson('Unexpected file retrieval failure.'),
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/blame',
        operationId: 'getFileBlame',
        tags: [gitTag.name],
        summary: 'Get file blame',
        description: dedent`
            Returns blame information for a file at a given repository path and optional git ref.

            The response is split into two parts:
            - \`ranges\`: contiguous, non-overlapping line ranges, each attributed to a single commit. Ordered by \`startLine\`.
            - \`commits\`: commit metadata (hash, date, message, author, optional \`previous\` pointer for walking back through history) keyed by hash, deduplicated across ranges.

            Whole-file renames are followed automatically. Cross-file line moves and copies are not.
        `,
        request: {
            query: publicFileBlameRequestSchema,
        },
        responses: {
            200: {
                description: 'Blame ranges and deduplicated commit metadata.',
                content: jsonContent(publicFileBlameResponseSchema),
            },
            400: errorJson('Invalid query parameters or git ref.'),
            404: errorJson('Repository or file not found.'),
            500: errorJson('Unexpected blame retrieval failure.'),
        },
    });

    registry.registerPath({
        method: 'post',
        path: '/api/tree',
        operationId: 'getFileTree',
        tags: [gitTag.name],
        summary: 'Get a file tree',
        description: 'Returns the file tree for a repository at a given revision.',
        request: {
            body: {
                required: true,
                content: jsonContent(publicGetTreeRequestSchema),
            },
        },
        responses: {
            200: {
                description: 'File tree for the requested repository revision.',
                content: jsonContent(publicGetTreeResponseSchema),
            },
            400: errorJson('Invalid request body or git ref.'),
            404: errorJson('Repository or path not found.'),
            500: errorJson('Unexpected tree retrieval failure.'),
        },
    });


    registry.registerPath({
        method: 'get',
        path: '/api/diff',
        operationId: 'getDiff',
        tags: [gitTag.name],
        summary: 'Get diff between two commits',
        description: 'Returns a structured diff between two git refs using a two-dot comparison. See [git-diff](https://git-scm.com/docs/git-diff) for details.',
        request: {
            query: publicGetDiffRequestSchema,
        },
        responses: {
            200: {
                description: 'Structured diff between the two refs.',
                content: jsonContent(publicGetDiffResponseSchema),
            },
            400: errorJson('Invalid query parameters or git ref.'),
            404: errorJson('Repository not found.'),
            500: errorJson('Unexpected diff failure.'),
        },
    });

    registry.registerPath({
        method: 'post',
        path: '/api/find_definitions',
        operationId: 'findDefinitions',
        tags: [searchTag.name],
        summary: 'Find symbol definitions',
        description: 'Returns all locations in the codebase where the given symbol is defined.',
        request: {
            body: {
                required: true,
                content: jsonContent(publicFindSymbolsRequestSchema),
            },
        },
        responses: {
            200: {
                description: 'Symbol definition locations.',
                content: jsonContent(publicFindSymbolsResponseSchema),
            },
            400: errorJson('Invalid request body.'),
            500: errorJson('Unexpected failure.'),
        },
    });

    registry.registerPath({
        method: 'post',
        path: '/api/find_references',
        operationId: 'findReferences',
        tags: [searchTag.name],
        summary: 'Find symbol references',
        description: 'Returns all locations in the codebase where the given symbol is referenced.',
        request: {
            body: {
                required: true,
                content: jsonContent(publicFindSymbolsRequestSchema),
            },
        },
        responses: {
            200: {
                description: 'Symbol reference locations.',
                content: jsonContent(publicFindSymbolsResponseSchema),
            },
            400: errorJson('Invalid request body.'),
            500: errorJson('Unexpected failure.'),
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/commits',
        operationId: 'listCommits',
        tags: [gitTag.name],
        summary: 'List commits',
        description: 'Returns a paginated list of commits for a repository.',
        request: {
            query: publicListCommitsQuerySchema,
        },
        responses: {
            200: {
                description: 'Paginated commit list.',
                headers: {
                    'X-Total-Count': {
                        description: 'Total number of commits matching the query across all pages.',
                        schema: { type: 'integer' },
                    },
                    Link: {
                        description: 'Pagination links formatted per RFC 8288.',
                        schema: { type: 'string' },
                    },
                },
                content: jsonContent(publicListCommitsResponseSchema),
            },
            400: errorJson('Invalid query parameters.'),
            404: errorJson('Repository not found.'),
            500: errorJson('Unexpected failure.'),
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/commit',
        operationId: 'getCommit',
        tags: [gitTag.name],
        summary: 'Get commit details',
        description: 'Returns details for a single commit, including parent commit SHAs.',
        request: {
            query: publicGetCommitQuerySchema,
        },
        responses: {
            200: {
                description: 'Commit details.',
                content: jsonContent(publicCommitDetailSchema),
            },
            400: errorJson('Invalid query parameters or git ref.'),
            404: errorJson('Repository or revision not found.'),
            500: errorJson('Unexpected failure.'),
        },
    });

    registry.registerPath({
        method: 'get',
        path: '/api/commits/authors',
        operationId: 'listCommitAuthors',
        tags: [gitTag.name],
        summary: 'List commit authors',
        description: 'Returns a paginated list of unique authors who committed in a repository, sorted by commit count descending. Optionally scoped to a file path.',
        request: {
            query: publicListCommitAuthorsQuerySchema,
        },
        responses: {
            200: {
                description: 'Paginated commit author list.',
                headers: {
                    'X-Total-Count': {
                        description: 'Total number of unique authors matching the query across all pages.',
                        schema: { type: 'integer' },
                    },
                    Link: {
                        description: 'Pagination links formatted per RFC 8288.',
                        schema: { type: 'string' },
                    },
                },
                content: jsonContent(publicListCommitAuthorsResponseSchema),
            },
            400: errorJson('Invalid query parameters or git ref.'),
            404: errorJson('Repository not found.'),
            500: errorJson('Unexpected failure.'),
        },
    });

    const generator = new OpenApiGeneratorV3(registry.definitions);

    const document = generator.generateDocument({
        openapi: '3.0.3',
        info: {
            title: 'Sourcebot Public API',
            version,
            description: 'OpenAPI description for the public Sourcebot REST endpoints used for search, repository listing, and file browsing. Authentication is instance-dependent: API keys are the standard integration mechanism, and some instances may allow anonymous access.',
        },
        tags: [searchTag, connectionsTag, reposTag, gitTag, systemTag],
        security: [
            { [securitySchemeNames.bearerToken]: [] },
            { [securitySchemeNames.apiKeyHeader]: [] },
            {},
        ],
    });

    const components: ComponentsObject = document.components ?? {};
    components.schemas = {
        ...(components.schemas ?? {}),
        PublicFileTreeNode: publicFileTreeNodeSchema,
    };
    components.securitySchemes = {
        ...(components.securitySchemes ?? {}),
        ...securitySchemes,
    };
    document.components = components;

    return document;
}
