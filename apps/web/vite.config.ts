import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  envDir: '../../',
  server: {
    port: 5173,
    // Same-origin API in development, so the SameSite=Strict refresh cookie works
    // exactly as behind Nginx in production.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
