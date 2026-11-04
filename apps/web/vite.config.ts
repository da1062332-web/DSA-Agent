import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@mui') || id.includes('@emotion')) {
              return 'vendor-mui';
            }
            if (
              id.includes('react') ||
              id.includes('scheduler') ||
              id.includes('@remix-run')
            ) {
              return 'vendor-react';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            return 'vendor-misc';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/public': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
    onConsoleLog(log) {
      if (log.includes('useLayoutEffect does nothing on the server')) {
        return false;
      }
    },
    // Unit tests use relative API paths and test default MFA enforcement; a developer's .env must not change them.
    env: { VITE_API_BASE_URL: '', VITE_DISABLE_MFA: 'false' },
  },
});
