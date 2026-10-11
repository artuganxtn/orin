import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = import.meta.dirname || dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  publicDir: resolve(__dirname, '../public'),
  build: {
    outDir: resolve(__dirname, '../firebase-dist'),
    emptyOutDir: true
  },
  server: {
    host: '0.0.0.0'
  }
});
