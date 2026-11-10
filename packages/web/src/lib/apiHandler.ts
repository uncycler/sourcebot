import { NextRequest } from 'next/server';
import { runWithRequestContext } from './requestContext';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyHandler = (...args: any[]) => Promise<Response> | Response;

/**
 * Creates an API route handler that runs inside a request context, so that
 * `getCurrentRequest()` resolves to the incoming request.
 *
 * @example
 * // Simple handler
 * export const GET = apiHandler(async (request) => {
 *     return Response.json({ data: 'hello' });
 * });
 *
 * @example
 * // Handler with route params
 * export const GET = apiHandler(async (request, { params }) => {
 *     const { id } = await params;
 *     return Response.json({ id });
 * });
 */
export function apiHandler<H extends AnyHandler>(handler: H): H {
    const wrappedHandler = async (request: NextRequest, ...rest: unknown[]) =>
        runWithRequestContext(request, async () => handler(request, ...rest));

    return wrappedHandler as H;
}
