# NEARvest web game

Mobile-first pixel-art web game (Vite + Preact + TypeScript). Talks to the game server in `../server`.

```sh
cd web
npm install
npm run dev        # http://localhost:5173 (server must run on http://127.0.0.1:8787)
npm run build      # static files in dist/ (for Vercel)
```

Set `VITE_API_URL` (see `.env.example`) to point at another server.

Try it: sign in with the dev login, pick a farmer name (demo mode on), check in, tap plot 1 and plant the Mango seed, water it, wait about a minute, harvest, sell to Mr. Darto, buy fertilizer in the Shop, then open Village to see every transaction on NEAR testnet.
