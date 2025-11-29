import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Keep loadEnv available if you later want to base config on env,
  // but Gemini now uses import.meta.env.VITE_GEMINI_API_KEY directly.
  loadEnv(mode, '.', '');

  return {
    server: {
      port: 5173,
      host: '0.0.0.0',
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
  };
});
