import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: true,
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.local/**',
        '**/*.session',
        '**/*.session-journal',
      ],
    },
    proxy: { '/api': { target: 'http://127.0.0.1:5187', changeOrigin: false } },
    watch: { awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 50 } },
  },
  preview: { host: '127.0.0.1', port: 5186, strictPort: true },
});
