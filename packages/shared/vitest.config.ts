import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/**/*.test.ts'],
        environment: 'node',
        watch: false,
        env: {
            AUTH_SECRET: 'test-secret',
            AUTH_URL: 'http://localhost:3000',
            DATA_CACHE_DIR: '/tmp/test-data',
            NODE_ENV: 'test',
            CONFIG_PATH: '/tmp/test-config.json',
            SOURCEBOT_ENCRYPTION_KEY: 'test-encryption-key-32chars-pad!',
        }
    }
});
