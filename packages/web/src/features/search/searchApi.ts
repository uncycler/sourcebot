import { sew } from "@/middleware/sew";
import { withOptionalAuth } from "@/middleware/withAuth";
import { QueryIR } from './ir';
import { parseQuerySyntaxIntoIR } from './parser';
import { SearchOptions } from "./types";
import { createZoektSearchRequest, zoektSearch, zoektStreamSearch } from './zoektSearcher';


type QueryStringSearchRequest = {
    queryType: 'string';
    query: string;
    options: SearchOptions;
    source?: string;
}

type QueryIRSearchRequest = {
    queryType: 'ir';
    query: QueryIR;
    // Omit options that are specific to query syntax parsing.
    options: Omit<SearchOptions, 'isRegexEnabled' | 'isCaseSensitivityEnabled'>;
    source?: string;
}

type SearchRequest = QueryStringSearchRequest | QueryIRSearchRequest;

export const search = (request: SearchRequest) => sew(() =>
    withOptionalAuth(async ({ prisma }) => {
        // If needed, parse the query syntax into the query intermediate representation.
        const query = request.queryType === 'string' ? await parseQuerySyntaxIntoIR({
            query: request.query,
            options: request.options,
        }) : request.query;

        const zoektSearchRequest = await createZoektSearchRequest({
            query,
            options: request.options,
        });

        return zoektSearch(zoektSearchRequest, prisma);
    }));

export const streamSearch = (request: SearchRequest) => sew(() =>
    withOptionalAuth(async ({ prisma }) => {
        // If needed, parse the query syntax into the query intermediate representation.
        const query = request.queryType === 'string' ? await parseQuerySyntaxIntoIR({
            query: request.query,
            options: request.options,
        }) : request.query;

        const zoektSearchRequest = await createZoektSearchRequest({
            query,
            options: request.options,
        });

        return zoektStreamSearch(zoektSearchRequest, prisma);
    }));
