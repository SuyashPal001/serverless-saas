import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'entitlements',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
