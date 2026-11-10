import { indexSchema } from "@sourcebot/schemas/v3/index.schema";
import { SourcebotConfig } from "@sourcebot/schemas/v3/index.type";
import { createEnv } from "@t3-oss/env-core";
import { Ajv } from "ajv";
import { readFile } from 'fs/promises';
import stripJsonComments from "strip-json-comments";
import { z } from "zod";
import { getTokenFromConfig } from "./crypto.js";

// Booleans are specified as 'true' or 'false' strings.
const booleanSchema = z.enum(["true", "false"]);

// Numbers are treated as strings in .env files.
// coerce helps us convert them to numbers.
// @see: https://zod.dev/?id=coercion-for-primitives
const numberSchema = z.coerce.number();
const ajv = new Ajv({
    validateFormats: false,
});

export const resolveEnvironmentVariableOverridesFromConfig = async (config: SourcebotConfig): Promise<Record<string, string>> => {
    if (!config.environmentOverrides) {
        return {};
    }

    const resolved: Record<string, string> = {};

    const start = performance.now();

    for (const [key, override] of Object.entries(config.environmentOverrides)) {
        switch (override.type) {
            case 'token':
                resolved[key] = await getTokenFromConfig(override.value);
                break;
            case 'boolean':
                resolved[key] = override.value ? 'true' : 'false';
                break;
            case 'number':
                resolved[key] = override.value.toString();
                break;
            case 'string':
                resolved[key] = override.value;
                break;
        }
    }

    const end = performance.now();
    console.debug(`resolved environment variable overrides in ${end - start}ms`);

    return resolved;
}

export const isRemotePath = (path: string) => {
    return path.startsWith('https://') || path.startsWith('http://');
}

export const loadConfig = async (configPath?: string): Promise<SourcebotConfig> => {
    if (!configPath) {
        throw new Error('CONFIG_PATH is required but not provided');
    }

    const configContent = await (async () => {
        if (isRemotePath(configPath)) {
            const response = await fetch(configPath);
            if (!response.ok) {
                throw new Error(`Failed to fetch config file ${configPath}: ${response.statusText}`);
            }
            return response.text();
        } else {
            // Retry logic for handling race conditions with mounted volumes
            const maxAttempts = 5;
            const retryDelayMs = 2000;
            let lastError: Error | null = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    return await readFile(configPath, {
                        encoding: 'utf-8',
                    });
                } catch (error) {
                    lastError = error as Error;

                    // Only retry on ENOENT errors (file not found)
                    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                        throw error; // Throw immediately for non-ENOENT errors
                    }

                    // Log warning before retry (except on the last attempt)
                    if (attempt < maxAttempts) {
                        console.warn(`Config file not found, retrying in 2s... (Attempt ${attempt}/${maxAttempts})`);
                        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                    }
                }
            }

            // If we've exhausted all retries, throw the last ENOENT error
            if (lastError) {
                throw lastError;
            }

            throw new Error('Failed to load config after all retry attempts');
        }
    })();

    const config = JSON.parse(stripJsonComments(configContent)) as SourcebotConfig;
    const isValidConfig = ajv.validate(indexSchema, config);
    if (!isValidConfig) {
        throw new Error(`Config file '${configPath}' is invalid: ${ajv.errorsText(ajv.errors)}`);
    }

    return config;
}

// Merge process.env with environment variables resolved from config.json
const runtimeEnv = await (async () => {
    const configPath = process.env.CONFIG_PATH;
    if (!configPath) {
        return process.env;
    }

    const config = await loadConfig(configPath);
    const overrides = await resolveEnvironmentVariableOverridesFromConfig(config);
    return {
        ...process.env,
        ...overrides,
    }
})();

const options = {
    server: {
        // Zoekt
        ZOEKT_WEBSERVER_URL: z.string().url().default("http://localhost:6070"),

        WORKER_API_URL: z.string().url().default("http://localhost:3060"),

        // Port the web process serves its Prometheus metrics on.
        WEB_METRICS_PORT: numberSchema.default(3070),

        // Auth
        AUTH_SECRET: z.string(),
        AUTH_URL: z.string().url(),

        /**
         * Relative time from now in seconds when to expire the session.
         * 
         * @default 30 days
         */
        AUTH_SESSION_MAX_AGE_SECONDS: numberSchema.default(60 * 60 * 24 * 30),

        /**
         * How often the session should be updated in seconds. If set to 0, session is updated every time.
         *
         * @default 1 day
         */
        AUTH_SESSION_UPDATE_AGE_SECONDS: numberSchema.default(60 * 60 * 24),

        DATA_CACHE_DIR: z.string(),

        // Email
        // Either SMTP_CONNECTION_URL or SMTP_HOST must be set to enable transactional emails.
        // @see: shared/src/smtp.ts for more details.
        SMTP_CONNECTION_URL: z.string().url().optional(),
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.coerce.number().optional(),
        SMTP_USERNAME: z.string().optional(),
        SMTP_PASSWORD: z.string().optional(),
        EMAIL_FROM_ADDRESS: z.string().email().optional(),

        LOGTAIL_TOKEN: z.string().optional(),
        LOGTAIL_HOST: z.string().url().optional(),

        NODE_ENV: z.enum(["development", "test", "production"]),

        // Database variables
        // Either DATABASE_URL or DATABASE_HOST, DATABASE_USERNAME, DATABASE_PASSWORD, and DATABASE_NAME must be set.
        // @see: shared/src/db.ts for more details.
        DATABASE_URL: z.string().url().optional(),
        DATABASE_HOST: z.string().optional(),
        DATABASE_USERNAME: z.string().optional(),
        DATABASE_PASSWORD: z.string().optional(),
        DATABASE_NAME: z.string().optional(),
        DATABASE_ARGS: z.string().optional(),

        CONFIG_PATH: z.string(),

        DEBUG_ENABLE_REACT_SCAN: booleanSchema.default('false'),
        DEBUG_ENABLE_REACT_GRAB: booleanSchema.default('false'),

        DISABLE_API_KEY_USAGE_FOR_NON_OWNER_USERS: booleanSchema.default('false'),

        DISABLE_API_KEY_CREATION_FOR_NON_OWNER_USERS: booleanSchema
            .optional()
            .transform(value => {
                return value ?? ((process.env.EXPERIMENT_DISABLE_API_KEY_CREATION_FOR_NON_ADMIN_USERS as 'true' | 'false') ?? 'false');
            }),

        // Used as the key for AES-256-CBC encryption (@see shared/src/crypto.ts).
        // The key is read as ASCII (1 char = 1 byte), so AES-256's 32-byte key
        // requirement means this must be exactly 32 characters. Generate one with
        // `openssl rand -base64 24` (24 random bytes => a 32-character base64 string).
        SOURCEBOT_ENCRYPTION_KEY: z.string().length(32, {
            message: "SOURCEBOT_ENCRYPTION_KEY must be exactly 32 characters (a 256-bit AES key). Generate one with `openssl rand -base64 24`.\nWARNING: Updating this value will invalidate any existing API keys.",
        }),

        FALLBACK_GITHUB_CLOUD_TOKEN: z.string().optional(),
        FALLBACK_GITLAB_CLOUD_TOKEN: z.string().optional(),
        FALLBACK_GITEA_CLOUD_TOKEN: z.string().optional(),

        REDIS_URL: z.string().url().default("redis://localhost:6379"),

        // Redis TLS
        REDIS_TLS_ENABLED: booleanSchema.default("false"),
        REDIS_TLS_CA_PATH: z.string().optional(),
        REDIS_TLS_CERT_PATH: z.string().optional(),
        REDIS_TLS_KEY_PATH: z.string().optional(),
        REDIS_TLS_SERVERNAME: z.string().optional(),
        REDIS_TLS_REJECT_UNAUTHORIZED: booleanSchema.optional(),
        REDIS_TLS_CHECK_SERVER_IDENTITY: booleanSchema.optional(),
        REDIS_TLS_SECURE_PROTOCOL: z.string().optional(),
        REDIS_TLS_CIPHERS: z.string().optional(),
        REDIS_TLS_HONOR_CIPHER_ORDER: booleanSchema.optional(),
        REDIS_TLS_KEY_PASSPHRASE: z.string().optional(),

        GITLAB_CLIENT_QUERY_TIMEOUT_SECONDS: numberSchema.default(60 * 10),

        SOURCEBOT_LOG_LEVEL: z.enum(["info", "debug", "warn", "error"]).default("info"),
        SOURCEBOT_STRUCTURED_LOGGING_ENABLED: booleanSchema.default("false"),
        SOURCEBOT_STRUCTURED_LOGGING_FILE: z.string().optional(),

        // Configure the default maximum number of search results to return by default.
        DEFAULT_MAX_MATCH_COUNT: numberSchema.default(10_000),

        // A comma separated list of glob patterns that shwould always be indexed regardless of their size.
        ALWAYS_INDEX_FILE_PATTERNS: z.string().optional(),

        //////////// Deprecated ////////////
        /**
         * @deprecated Configure this setting via the "Require approval
         * for new members" toggle in Settings → Security intsead.
         */
        REQUIRE_APPROVAL_NEW_MEMBERS: booleanSchema.optional(),

        /**
         * @deprecated Configure email + password login via the "Email & password login"
         * toggle in Settings → Security instead. When set, this env var overrides the UI
         * setting and locks the toggle; when unset, the DB-backed
         * `Org.isCredentialsLoginEnabled` setting is used.
         */
        AUTH_CREDENTIALS_LOGIN_ENABLED: booleanSchema.optional(),

        /**
         * @deprecated Configure email code login via the UI in Settings → Security
         * instead. When set, this env var overrides the UI setting and locks the toggle;
         * when unset, the DB-backed `Org.isEmailCodeLoginEnabled` setting is used. Left
         * optional (rather than defaulting to 'false') so we can detect whether it was
         * explicitly set.
         */
        AUTH_EMAIL_CODE_LOGIN_ENABLED: booleanSchema.optional(),

        /**
         * @deprecated Configure anonymous access via the UI in Settings → Security
         * instead. When set, this env var overrides the UI setting and locks the toggle;
         * when unset, the DB-backed `Org.isAnonymousAccessEnabled` setting is used. Left
         * optional (rather than defaulting to 'false') so we can detect whether it was
         * explicitly set.
         */
        FORCE_ENABLE_ANONYMOUS_ACCESS: booleanSchema.optional(),

    },
    runtimeEnv,
    emptyStringAsUndefined: true,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
}

// The typecast below uses `typeof options['server']` in a mapped type, which causes TypeScript to
// emit a reference to the named `options` export in the `.d.ts` declaration file. This is what
// preserves JSDoc comments (including `@deprecated`) on individual env var properties — without
// it, the return type of `createEnv` does not reference `options` by name and TypeScript loses
// the JSDoc. `options` must also be an exported named declaration (not an anonymous inline
// literal) for TypeScript to resolve and emit its JSDoc.
// See: https://github.com/microsoft/TypeScript/issues/62309
export const env = createEnv(options) as unknown as {
    [K in keyof typeof options['server']]: z.output<(typeof options['server'])[K]>
}
