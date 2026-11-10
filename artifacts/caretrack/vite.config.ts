import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

// Environment variables live in the repository-root .env file.
const env = { ...loadEnv('', path.resolve(import.meta.dirname, '..', '..'), ''), ...process.env };

const port = Number(env.WEB_PORT ?? 5173);
if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid WEB_PORT value: "${env.WEB_PORT}"`);
}

// During development, API calls are proxied to the Express server.
const apiTarget = `http://localhost:${env.PORT ?? 8080}`;

export default defineConfig({
  base: env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  define: {
    // Android app only: the public HTTPS address of the CareTrack server (not a secret).
    // When empty, the app asks for it on first launch. The web version ignores it.
    'import.meta.env.VITE_CARETRACK_API_URL': JSON.stringify(env.CARETRACK_API_URL ?? ''),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
});
