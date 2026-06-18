import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5179,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: './index.html',
        readme: './public/readme.html',
      }
    }
  }
});
