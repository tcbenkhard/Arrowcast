import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': `http://127.0.0.1:${process.env.ARROWCAST_E2E_API_PORT ?? 3000}`,
    },
  },
});
