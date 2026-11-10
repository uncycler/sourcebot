# Claude Code Guidelines

## Database Migrations

When creating Prisma database migrations, run from the repository root:

```bash
yarn dev:prisma:migrate:dev --name <migration_name>
```

Do NOT use `npx prisma migrate dev` directly from packages/db.

## Building Packages

To build a specific package:

```bash
yarn workspace @sourcebot/<package-name> build
```

## Backend Workloads

Use the workload system in `packages/backend` for background work. Define the queue payload and default job behavior in the shared queue registry, implement a `Workload`, and register it with the `JobManager`.

### Execution locks

- Key an execution lock by the logical resource being mutated, not by the job ID. Workloads that mutate the same resource must use the exact same lock key. For example, repo indexing and repo cleanup share the per-repo filesystem and search-index lock. Connection syncing uses its own per-connection lock.
- An execution lock serializes work but does not deduplicate it. Multiple jobs for one resource may still be queued and will execute one at a time.
- The lock lease is extended automatically while work is running. The workload's `AbortSignal` is aborted if extension fails or the worker shuts down.
- Abortion is cooperative. Call `signal.throwIfAborted()` before side effects and after long-running or external operations so work stops promptly after losing the lock. The signal cannot cancel an operation that has already been submitted.
- `onStarted` runs after the execution lock is acquired and immediately before `process`. `onCompleted` and `onTerminalFailure` are BullMQ event hooks and run after the processor has returned and released the lock.

### Lifecycle state

- BullMQ is the default source of truth for workload lifecycle state. Only persist a separate database job row when the product explicitly requires durable history beyond the queue's retention policy.
- If a parent resource tracks a `latest...JobId`, update that pointer when the job starts so consumers can resolve its state from BullMQ.
- For workloads that persist historical job rows, completion and terminal-failure hooks must always update their own row by job ID. Do not condition that update on the job still being latest. Every persisted job row should record its actual outcome.
- `onTerminalFailure` only runs after the job exhausts all retry attempts. Intermediate failures are retried without marking the lifecycle row as terminally failed.
- If a completion or failure hook publishes state onto the parent resource, use a conditional `updateMany` keyed by both the resource ID and its `latest...JobId`. This prevents an older hook from overwriting state belonging to a newer job after the execution lock has been released.
- Parent-resource state written inside `process` is already serialized by the execution lock. It does not need a latest-job conditional merely because the resource tracks the latest job ID.

## File Naming

Files should use camelCase starting with a lowercase letter:

```
// Correct
shareChatPopover.tsx
userAvatar.tsx
apiClient.ts

// Incorrect
ShareChatPopover.tsx
UserAvatar.tsx
share-chat-popover.tsx
```

Exceptions:
- Special files like `README.md`, `CONTRIBUTING.md`, `LICENSE.md`
- Next.js conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, etc.

## Code Style

Always use curly braces for `if` statements, with the body on a new line — even for single-line bodies:

```ts
// Correct
if (!value) {
    return;
}
if (condition) {
    doSomething();
}

// Incorrect
if (!value) return;
if (!value) { return; }
if (condition) doSomething();
```

## Conditional ClassNames

Use `cn()` from `@/lib/utils` for conditional classNames instead of template literal interpolation:

```tsx
// Correct
className={cn("border-b transition-colors", isActive ? "border-foreground" : "border-transparent")}

// Incorrect
className={`border-b transition-colors ${isActive ? "border-foreground" : "border-transparent"}`}
```

## Tailwind CSS

Use Tailwind color classes directly instead of CSS variable syntax:

```tsx
// Correct
className="border-border bg-card text-foreground text-muted-foreground bg-muted bg-secondary"

// Incorrect
className="border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
```

## API Route Handlers

When implementing a new API route, ask the user whether it should be part of the public API. If yes:

1. Add the request/response Zod schemas to `packages/web/src/openapi/publicApiSchemas.ts`, calling `.openapi('SchemaName')` on each schema to register it with a name.
2. Register the route in `packages/web/src/openapi/publicApiDocument.ts` using `registry.registerPath(...)`, assigning it to the appropriate tag.
3. Add the endpoint to the relevant group in the `API Reference` tab of `docs/docs.json`.
4. Regenerate the OpenAPI spec by running `yarn workspace @sourcebot/web openapi:generate`.

Route handlers should validate inputs using Zod schemas. Put coercion, defaults, minimums, maximums, and cross-field validation in the schema instead of scattering parsing logic through the handler.

**Query parameters** (GET requests):

```ts
import { queryParamsSchemaValidationError, serviceErrorResponse } from "@/lib/serviceError";
import { z } from "zod";

const myQueryParamsSchema = z.object({
    repo: z.string(),
    page: z.coerce.number().int().positive().default(1),
    perPage: z.coerce.number().int().positive().max(100).default(50),
});

export const GET = apiHandler(async (request: NextRequest) => {
    const rawParams = Object.fromEntries(
        Object.keys(myQueryParamsSchema.shape).map(key => [
            key,
            request.nextUrl.searchParams.get(key) ?? undefined
        ])
    );
    const parsed = myQueryParamsSchema.safeParse(rawParams);

    if (!parsed.success) {
        return serviceErrorResponse(
            queryParamsSchemaValidationError(parsed.error)
        );
    }

    const { page, perPage, ...searchParams } = parsed.data;
    const skip = (page - 1) * perPage;
    // ... rest of handler
});
```

**Search query parameters**:

```ts
import { queryParamsSchemaValidationError, serviceErrorResponse } from "@/lib/serviceError";
import { z } from "zod";

const searchMembersQueryParamsSchema = z.object({
    query: z.string().default(''),
});

export const GET = apiHandler(async (request: NextRequest) => {
    const rawParams = Object.fromEntries(
        Object.keys(searchMembersQueryParamsSchema.shape).map(key => [
            key,
            request.nextUrl.searchParams.get(key) ?? undefined
        ])
    );
    const parsed = searchMembersQueryParamsSchema.safeParse(rawParams);

    if (!parsed.success) {
        return serviceErrorResponse(
            queryParamsSchemaValidationError(parsed.error)
        );
    }

    const { query } = parsed.data;
    // ... use query in the database/search call
});
```

**Request body** (POST/PUT/PATCH requests):

```ts
import { requestBodySchemaValidationError, serviceErrorResponse } from "@/lib/serviceError";
import { z } from "zod";

const myRequestBodySchema = z.object({
    name: z.string(),
    count: z.number().optional(),
});

export const POST = apiHandler(async (request: NextRequest) => {
    const body = await request.json();
    const parsed = myRequestBodySchema.safeParse(body);

    if (!parsed.success) {
        return serviceErrorResponse(
            requestBodySchemaValidationError(parsed.error)
        );
    }

    const { name, count } = parsed.data;
    // ... rest of handler
});
```

Use `safeParseAsync` when the schema has async refinements, as in search routes:

```ts
const body = await request.json();
const parsed = await searchRequestSchema.safeParseAsync(body);
```

## Data Fetching

For GET requests, prefer using API routes with react-query over server actions. This provides caching benefits and better control over data refetching.

```tsx
// Preferred: API route + react-query
import { useQuery } from "@tanstack/react-query";

const { data, isLoading } = useQuery({
    queryKey: ["items", id],
    queryFn: () => fetch(`/api/items/${id}`).then(res => res.json()),
});
```

Server actions should be used for mutations (POST/PUT/DELETE operations), not for data fetching.

## Authentication

Use `withAuth` or `withOptionalAuth` from `@/middleware/withAuth` to protect server actions and API routes.

- **`withAuth`** - Requires authentication. Returns `notAuthenticated()` if user is not logged in.
- **`withOptionalAuth`** - Allows anonymous access if the org has anonymous access enabled. `user` may be `undefined`.
- **`withMinimumOrgRole`** - Wrap inside auth context to require a minimum role (e.g., `OrgRole.OWNER`). Import from `@/middleware/withMinimumOrgRole`.

**Important:** Always use the `prisma` instance provided by the auth context. Do NOT import `prisma` directly from `@/prisma` in actions or routes that return data to the client; keeping data access behind the auth context is what lets scoping be added in one place.

**Server actions** - Wrap with `sew()` for error handling:

```ts
'use server';

import { sew } from "@/middleware/sew";
import { withAuth } from "@/middleware/withAuth";

export const myProtectedAction = async ({ id }: { id: string }) => sew(() =>
    withAuth(async ({ org, user, prisma }) => {
        // user is guaranteed to be defined
        // prisma is scoped to the user
        return { success: true };
    })
);

export const myPublicAction = async ({ id }: { id: string }) => sew(() =>
    withOptionalAuth(async ({ org, user, prisma }) => {
        // user may be undefined for anonymous access
        return { success: true };
    })
);
```

**API routes** - Check `isServiceError` and return `serviceErrorResponse`:

```ts
import { serviceErrorResponse } from "@/lib/serviceError";
import { isServiceError } from "@/lib/utils";
import { withAuth } from "@/middleware/withAuth";

export const GET = apiHandler(async (request: NextRequest) => {
    const result = await withAuth(async ({ org, user, prisma }) => {
        // ... your logic
        return data;
    });

    if (isServiceError(result)) {
        return serviceErrorResponse(result);
    }

    return Response.json(result);
});
```

## Membership States

Organization membership state is derived from fields on `UserToOrg`:

- **Active**: `suspendedAt` is `null` and `lastActiveAt` is not `null`. Active members can access the org.
- **Pending**: `suspendedAt` is `null` and `lastActiveAt` is `null`. Pending users can access the org but have not signed in yet.
- **Suspended**: `suspendedAt` is not `null`. Suspended users cannot access the org.

When filtering memberships, use the helper predicates from `packages/web/src/features/membership/utils.ts` instead of writing these conditions inline. This keeps auth and UI queries aligned as the state rules evolve.

```ts
import {
    activeMembershipWhere,
    activeOrPendingMembershipWhere,
    pendingMembershipWhere,
    suspendedMembershipWhere,
} from "@/features/membership/utils";

// Billable seat count.
await prisma.userToOrg.count({
    where: {
        orgId,
        ...activeMembershipWhere(),
    },
});

// Users who should be able to access the org.
await prisma.userToOrg.findMany({
    where: {
        orgId,
        ...activeOrPendingMembershipWhere(),
    },
});
```

## Next.js Router Navigation

Do NOT call `router.refresh()` immediately after `router.push()`. In Next.js 16, the prefetch cache and navigation system was completely rewritten, and calling `router.refresh()` right after `router.push()` creates a race condition. The refresh invalidates the cache and can interrupt the in-flight navigation, leaving the page stuck or not loading.

```ts
// Bad - router.refresh() races with router.push() in Next.js 16
router.push(url);
router.refresh(); // ❌ can cancel the navigation

// Good - if navigating to a new route, the page will fetch fresh data on load
router.push(url); // ✅
```

If you need to refresh server component data after a mutation, use the server-side `refresh()` from `next/cache` in a Server Action instead of `router.refresh()` on the client.

## Documentation Writing Style

When writing or editing `.mdx` files in `docs/`:

- Do NOT use em dashes (`—`). Use periods to break sentences, commas, or parentheses instead.
- Write in second person ("you") and present tense.
- Keep sentences short and direct. Lead with what the user needs to know.
- Use bold for UI elements and key terms (e.g., **Settings → API Keys**).
- Use inline code for technical values, flags, and identifiers (e.g., `REPO_READ`).
- Prefer short paragraphs (1-3 sentences). Use bullet lists to break up dense information.
- Use tables for parameter documentation.

## Docs Images

Images added to `.mdx` files in `docs/` should be wrapped in a `<Frame>` component:

```mdx
<Frame>
  <img src="/images/my_image.png" alt="Description" />
</Frame>
```

## Fixing CVEs

When fixing a CVE in a transitive dependency, prefer a real top-level upgrade over a forced `resolutions` override.

1. **Trace the dependency chain to a package in your own `package.json`.** Run:

   ```bash
   yarn why <vulnerable-package> --recursive
   ```

   "Top-level" means a package **literally listed in this repo's root or workspace `package.json`** under `dependencies`, `devDependencies`, or `peerDependencies` — not just any ancestor in the chain. If the chain is `vulnerable-pkg → mid-pkg → top-pkg`, do not stop at `mid-pkg`; keep walking until you reach `top-pkg`.

2. **Check whether the existing ranges already allow a patched version.** Often the lockfile is just stale: every `^x.y.z` range in the chain still admits the patched version, but `yarn.lock` was written before that version existed. In that case, refresh the lockfile entry — no `package.json` change, no `resolutions` override:

   ```bash
   yarn up -R <vulnerable-pkg>
   ```

   This is the lightest-weight fix: it doesn't force a version, it just bumps the lock to the latest version that satisfies the constraints already in the tree. Verify with `yarn why <vulnerable-package>` afterward — if every instance is now patched, you're done.

3. **If a refresh isn't enough, bump the top-level dependency** to a version whose transitive tree no longer includes the vulnerable version. This is also a real, supported upgrade. Verify the upgrade actually removes the vulnerable version with `yarn why <vulnerable-package>` after running `yarn install`.

4. **Fall back to a `resolutions` override** only if neither a refresh nor a top-level bump resolves it (no compatible version exists in the existing ranges, or a top-level upgrade would require a breaking major). Use the **qualified** form keyed to the existing source range (not a bare key, which overrides every requester unnecessarily), and pin with `^`, not `>=`:

   ```json
   "resolutions": {
       "<pkg>@npm:<existing-source-range>": "^<patched>"
   }
   ```

   The `<existing-source-range>` is whatever range is currently requesting the vulnerable version (find it in `yarn.lock`, e.g. `^2.8.3`). Avoid the bare-key form `"<pkg>": "^x.y.z"`.

### Branch naming for CVE fixes

Use a **package-keyed** branch name, not a CVE-keyed one:

```
fix/cve-<package>
```

Multiple CVEs against the same package commonly land in one upstream release, so package-keyed branches let sibling work join the same merge request (see "Batching CVEs" below). Do not include the CVE ID in the branch name.

### Batching CVEs that share a package

CVEs often arrive in clusters because one package release fixes several at once. Before opening a new merge request, check whether an open one already addresses the same package:

```bash
glab mr list --search '<package>'
```

- **An open MR already pins a version that fixes this CVE**: add the CVE ID to its title and description. Do not open a new MR.
- **An open MR exists but its pin is too low**: check out its branch, bump the version to cover both CVEs, and update the title and description.
- **No open MR exists**: create a new `fix/cve-<package>` branch and open the MR as usual.

Renovate also opens dependency update MRs on this repository. If a Renovate MR already upgrades the vulnerable package far enough, prefer merging it over opening a new one.

### Merge request conventions for CVE fixes

- Title format: `chore: upgrade <pkg> to ^x.y.z to address CVE-A, CVE-B, ...` (list every CVE the MR resolves).
- List the CVE IDs and the dependency chain you traced in the MR description.

## Branches and Merge Requests

This repository is hosted on GitLab at `git.kudelski.com:KS/solutions/ide-infra/sourcebot`. Use `glab` (not `gh`) for merge requests, issues, and pipelines. The default branch is `master`.

When creating a branch or opening a merge request, ask the user for the related issue or ticket, if there is one.

Branch naming convention: `<type>/<short-description>`, where `<type>` is one of the conventional commit types below (e.g. `fix/search-scroll-state`, `chore/combined-renovate-updates`).

Merge request titles follow conventional commit standards:
- `feat:` new feature or functionality
- `fix:` bug fix
- `docs:` documentation or README changes
- `chore:` maintenance tasks, dependency updates, etc.
- `refactor:` code refactoring without changing behavior
- `test:` adding or updating tests

You can optionally include a scope to indicate which package is affected:
- `feat(web):` feature in the web package
- `fix(worker):` bug fix in the worker package (`backend/`)

Merge request description:
- If an issue or ticket was provided, reference it (e.g. `Closes #123` for a GitLab issue).
- Explain what changed, why, and how you verified it.

This fork does not keep a `CHANGELOG.md`. Do not add changelog entries.
