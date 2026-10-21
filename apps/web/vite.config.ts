import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@arrowcast/contracts/i18n': fileURLToPath(new URL('../../packages/contracts/src/i18n.ts', import.meta.url)),
    },
  },
  server: {
    allowedHosts: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.ARROWCAST_E2E_API_PORT ?? 3000}`,
    },
  },
});
