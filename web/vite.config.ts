import preact from '@preact/preset-vite';
import { defineConfig, type Connect } from 'vite';

/**
 * Pages: / is the landing page (index.html), /play the game (play.html); /privacy and /terms are
 * static pages (public/*.html). Vercel serves them without ".html" (vercel.json cleanUrls); this
 * does the same for `npm run dev` / `preview`.
 */
const cleanPages: Connect.NextHandleFunction = (req, _res, next) => {
  const r = req as { url?: string };
  const path = r.url?.split('?')[0];
  if (path === '/privacy' || path === '/terms' || path === '/play') r.url = `${path}.html${r.url!.slice(path.length)}`;
  next();
};

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        // Relative to the web/ folder (Vite's root).
        index: 'index.html',
        play: 'play.html',
      },
    },
  },
  plugins: [
    preact(),
    {
      name: 'nearvest-clean-pages',
      configureServer: (server) => void server.middlewares.use(cleanPages),
      configurePreviewServer: (server) => void server.middlewares.use(cleanPages),
    },
  ],
});
