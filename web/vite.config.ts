import preact from '@preact/preset-vite';
import { defineConfig, type Connect } from 'vite';

/**
 * /privacy and /terms are static pages (public/privacy.html, public/terms.html). Vercel serves
 * them without ".html" (vercel.json cleanUrls); this does the same for `npm run dev` / `preview`.
 */
const cleanPages: Connect.NextHandleFunction = (req, _res, next) => {
  const r = req as { url?: string };
  const path = r.url?.split('?')[0];
  if (path === '/privacy' || path === '/terms') r.url = `${path}.html`;
  next();
};

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'nearvest-clean-pages',
      configureServer: (server) => void server.middlewares.use(cleanPages),
      configurePreviewServer: (server) => void server.middlewares.use(cleanPages),
    },
  ],
});
