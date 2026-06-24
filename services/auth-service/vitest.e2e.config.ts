import path from 'node:path';
import { defineConfig } from 'vitest/config';

// e2e tests run against real infra (PostgreSQL + Redis) reachable on localhost,
// e.g. via `docker compose up -d auth-db redis` from the repo root.
// Self-contained on purpose: works the same locally and in CI service containers,
// without depending on the gitignored root .env file.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['e2e/**/*.e2e.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      AUTH_DB_URL: 'postgres://chatapp_auth_user:testpassword@localhost:5432/chatapp_auth_service',
      RABBITMQ_URL: 'amqp://guest:guest@localhost:5672',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'e2e-test-jwt-secret-needs-32-characters-min',
      JWT_REFRESH_SECRET: 'e2e-test-jwt-refresh-secret-needs-32-chars',
      INTERNAL_API_TOKEN: 'e2e-test-internal-api-token-32-characters',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
