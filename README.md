# Horse Race Demo

Mobile-first local horse race betting app for small groups (2-5 players), with a Node/Express backend and React/Vite frontend.

## Phase Status

- Phase 1 (foundation) is implemented:
  - Workspace + server/client setup
  - SQLite schema initialization
  - Player creation/listing
  - Manual race + horse entry
  - LAN-ready dev config (`0.0.0.0` + Vite `host: true`)
- Baseline algorithm system is integrated into the React app:
  - Editable factor table
  - Server-backed race analysis endpoint
  - Top-five tickets, undercover winner, and counter-bets
  - Live-odds refresh endpoint for race-card updates
- Phase 2+ (bet engine, settlement, algorithm service routes, external data ingestion) is next.

## Tech Stack

- Backend: Node.js, Express, Socket.IO, SQLite (`better-sqlite3`)
- Frontend: React, Vite, React Router, Tailwind CSS, Socket.IO client

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy env vars:

```bash
cp .env.example .env
```

3. Run both apps:

```bash
npm run dev
```

Or use:

```bash
./scripts/start.sh
```

## Local Network Access (iPhone)

1. Ensure phone and development machine are on the same Wi-Fi network.
2. Find your machine IP address (example: `192.168.1.25`).
3. Open `http://<your-ip>:5173` on iPhone Safari.

## API Surface (Current)

- `GET /api/health`
- `GET /api/users`
- `POST /api/users`
- `GET /api/races`
- `GET /api/races/:raceId`
- `POST /api/races`
- `PATCH /api/races/:raceId/status`
- `POST /api/algorithm/analyze`
- `POST /api/algorithm/live-odds`

## Repo Structure

- `server/` Express + DB + Socket setup
- `client/` React mobile-first app shell
- `scripts/` startup helpers
- `server.js`, `app.js`, `algorithmEngine.js`, `data.js` legacy prototype path retained for reference (`npm run start:legacy`)
- `From_Claude/` prior planning/research artifacts

## Next Build Targets

1. Bet validator + combination expansion for exacta/quinella/trifecta/superfecta/super hi-5.
2. Pool accounting + parimutuel payout service.
3. Bet placement APIs + live feed updates via Socket.IO.
4. Results entry + automated settlement.
