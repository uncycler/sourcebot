import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
    clientPrefix: "NEXT_PUBLIC_",
    client: {
        NEXT_PUBLIC_BUILD_COMMIT_SHA: z.string().optional(),
    },
    runtimeEnvStrict: {
        NEXT_PUBLIC_BUILD_COMMIT_SHA: process.env.NEXT_PUBLIC_BUILD_COMMIT_SHA,
    },
    emptyStringAsUndefined: true,
    skipValidation: process.env.SKIP_ENV_VALIDATION === "1",
});