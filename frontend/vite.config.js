import { defineConfig } from 'vite';
export default defineConfig({
  server: { proxy: { '/api': 'http://localhost:4000', '/socket.io': { target: 'http://localhost:4000', ws: true } } },
  build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'], runtime: ['react', 'react-dom', 'socket.io-client'] } } } }
});
