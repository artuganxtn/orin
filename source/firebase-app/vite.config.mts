import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = import.meta.dirname || dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  resolve: {
    alias: {
      '@': resolve(__dirname, '..')
    }
  },
  plugins: [react()],
  publicDir: resolve(__dirname, '../public'),
  build: {
    manifest: true,
    target: 'chrome90',
    outDir: resolve(__dirname, '../firebase-dist'),
    emptyOutDir: true
  },
  server: {
    host: '0.0.0.0',
    proxy: {
      '/api': 'http://127.0.0.1:5001/demo-orin-auth/europe-west1/orinApi'
    }
  }
});
