import {defineConfig} from 'vite';

export default defineConfig({
  base: './',
  server: {
    // Disable HMR because the application uses vanilla JS is updated in turns
    hmr: false,
    host: '0.0.0.0',
    port: 3000
  }
});
