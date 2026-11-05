import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built UI works under Home Assistant ingress path prefixes.
  base: './',
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
  worker: { format: 'es' },
});
