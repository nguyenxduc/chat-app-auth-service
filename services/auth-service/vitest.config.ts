import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    env: {
      AUTH_DB_URL: 'mysql://test:test@localhost:3306/test',
      JWT_SECRET: 'test-jwt-secret-needs-32-characters-min',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret-needs-32-characters',
      RABBITMQ_URL: 'amqp://localhost',
      INTERNAL_API_TOKEN: 'test-internal-api-token-needs-32-characters',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
