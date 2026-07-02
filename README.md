# FORGE — complete deploy-ready folder

FORGE is the VYBSTAK developer relief engine for indie game developers. Pitch your game, receive a publisher-grade greenlight report — genre market sizing, real comparable titles, a prototype-to-launch production roadmap, a scope-honest risk register, and a Forge verdict score. Pro tier adds FORGE DECK: a publisher-ready `.pptx` pitch deck generated natively.

Built on the same deploy-proven architecture as MOTOR GENESIS. This package runs locally, on GitHub, and on Railway with no changes.

## Included

- `server.js` , Express server (Forge engine, enhance, VIP, Stripe, FORGE DECK pptx generation)
- `public/index.html` , main frontend experience (WebGPU particle field, greenlight overlay, report renderer)
- `package.json` and `package-lock.json`
- `railway.json` , Railway deploy config
- `.env.example` , required environment variables
- `.gitignore`
- `nodemon.json`
- `public/decks/` , generated pitch decks land here
- `public/assets/` , placeholder for extra media assets

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

```bash
http://localhost:3000
```

## Production start

```bash
npm start
```

## Required environment variables

### Core
- `PORT`
- `APP_URL`
- `SECRET_KEY`

### Anthropic
- `ANTHROPIC_API_KEY`
- `FORGE_MODEL` (falls back to `GENESIS_MODEL` if set — painless migration from MOTOR GENESIS Railway variables)
- `FORGE_PRO_MODEL` (falls back to `GENESIS_PRO_MODEL`)

### Stripe, only if using paid checkout
- `STRIPE_SECRET_KEY`
- `STRIPE_PRO_PRICE_ID`

### VIP codes
- `VIP_CODES` (defaults: `FORGE-EARLY-ACCESS,VYBSTAK-PRO,VALENCIA-GAMECITY`)

## Railway deployment

1. Push this folder to GitHub
2. Create a new Railway project
3. Deploy from GitHub
4. Add the values from `.env.example` into Railway Variables
5. Point your custom domain after the Railway URL works

## API surface

| Endpoint | Method | Purpose |
|---|---|---|
| `/health` | GET | Health check |
| `/api/usage` | GET | Free-tier usage for the caller's IP |
| `/api/enhance` | POST | Sharpen a rough game pitch (hook, fantasy, loop) |
| `/api/forge` | POST | Run the full greenlight report |
| `/api/launchpad` | POST | Generate FORGE DECK pptx (Pro only) |
| `/api/vip` | POST | Redeem a VIP access code |
| `/api/checkout` | POST | Stripe checkout session |
| `/api/verify` | POST | Verify a Stripe session → Pro token |

## Notes

- Generated decks are written into `public/decks/` and auto-cleaned after 2 hours
- `public/assets/` is ready for logos, sound, textures, or future uploads
- If Stripe is not configured, the rest of the app still runs
- The report JSON schema is identical to MOTOR GENESIS — only the intelligence domain changed, so any downstream tooling keeps working
