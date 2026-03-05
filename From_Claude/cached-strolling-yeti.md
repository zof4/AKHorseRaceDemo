# Horse Race Betting App — Implementation Plan

## Context

Build a local horse race betting app for 2-5 friends to use together (e.g., at a watch party). Users bet with fake money on real or manually-entered races using exotic bet types (Exacta, Quinella, Trifecta, Superfecta, Super Hi-5). All bets update in real-time via WebSockets. An algorithm section scores horses, recommends bets, identifies sleeper picks, and places its own bets as a competitor.

**Stack**: Node.js/Express + React/Vite + SQLite + Socket.IO + TailwindCSS
**Project root**: `/Users/cweiss/ai/ponyside/`

---

## Phase 1: Foundation

Set up project scaffolding, database, user system, and manual race entry.

**Files:**
- `ponyside/package.json` — root workspace
- `ponyside/server/package.json` — express, socket.io, better-sqlite3, cors, dotenv
- `ponyside/client/package.json` — react, react-router-dom, socket.io-client, tailwindcss
- `ponyside/server/index.js` — Express + Socket.IO, binds `0.0.0.0` for LAN
- `ponyside/server/db/schema.sql` — tables: users, races, horses, results, bets, pools, algo_analysis
- `ponyside/server/db/connection.js` — better-sqlite3 singleton, auto-runs schema
- `ponyside/server/routes/users.js` — POST create user (starts with $1000), GET list
- `ponyside/server/routes/races.js` — CRUD for races + manual horse entry
- `ponyside/client/vite.config.js` — `host: true`, proxy `/api` and `/socket.io` to Express
- `ponyside/client/src/App.jsx` — React Router with bottom tab navigation
- `ponyside/client/src/pages/Lobby.jsx` — enter name, see players + balances
- `ponyside/client/src/pages/RaceList.jsx` — browse races
- `ponyside/client/src/pages/ManualRaceEntry.jsx` — form to create race + horses
- `ponyside/client/src/components/Header.jsx`, `BottomNav.jsx`
- `ponyside/client/tailwind.config.js`, `postcss.config.js`, `src/index.css`

**DB Schema highlights:**
- `users`: id, name, balance (default 1000), is_algo_bot
- `races`: id, name, track, race_number, distance, surface, class, post_time, status (upcoming/open/closed/official), source (manual/api), takeout_pct (default 0.22)
- `horses`: id, race_id, name, post_position, jockey, trainer, morning_line_odds, weight, age, sex, recent_form (JSON), speed_figures (JSON), jockey_win_pct, trainer_win_pct, class_rating, scratched
- `bets`: id, user_id, race_id, bet_type, bet_modifier (straight/box/wheel/key), selections (JSON), base_amount, total_cost, num_combinations, payout, is_winner
- `pools`: race_id + bet_type -> total_amount
- `results`: race_id, horse_id, finish_position
- `algo_analysis`: race_id, horse_id, scores (6 factors), is_sleeper, explanation

**Verify**: Open `http://<machine-ip>:5173` on iPhone, create user, create race with horses.

---

## Phase 2: Betting Engine

All 5 exotic bet types with box/wheel/key modifiers. Parimutuel pool math.

**Files:**
- `server/utils/betValidator.js` — validate bet structure, expand combinations
- `server/services/parimutuel.js` — pool calculation: `net_pool = gross * (1 - takeout)`, `payout_per_dollar = floor(net_pool / winning_bets / 0.10) * 0.10`
- `server/routes/bets.js` — POST place bet (validate, deduct balance, update pool), GET bets by race/user, GET pool status
- `client/src/pages/PlaceBet.jsx` — step flow: bet type -> modifier -> horse selection -> amount -> confirm
- `client/src/pages/RaceDetail.jsx` — horses, odds, pools, bet button
- `client/src/components/BetTypeSelector.jsx`, `BoxWheelToggle.jsx`, `HorsePicker.jsx`, `BetSlip.jsx`, `OddsDisplay.jsx`
- `client/src/utils/betMath.js` — client-side combo counting + cost preview

**Bet types & combination formulas:**
| Type | Min Bet | Box Formula |
|------|---------|-------------|
| Exacta | $1 | N*(N-1) |
| Quinella | $1 | N*(N-1)/2 |
| Trifecta | $1 | N*(N-1)*(N-2) |
| Superfecta | $0.10 | N*(N-1)*(N-2)*(N-3) |
| Super Hi-5 | $0.10 | N*(N-1)*(N-2)*(N-3)*(N-4) |

**Verify**: Place an exacta box on 3 horses = 6 combos at $1 = $6 deducted. Pool total updates.

---

## Phase 3: Real-Time + Results Settlement

WebSocket live feed + race results entry + automatic bet settlement.

**Files:**
- `server/socket/handler.js` — events: join_race, bet_placed, pool_updated, race_status, results_in
- `server/routes/results.js` — POST enter finishing order, triggers settlement of all bets
- `client/src/socket.js` — Socket.IO client singleton
- `client/src/hooks/useSocket.js`, `useBets.js`, `useRace.js`
- `client/src/pages/LiveBets.jsx` — real-time scrolling bet feed
- `client/src/pages/Results.jsx` — results + payouts display
- `client/src/components/BetFeed.jsx`, `UserBetCard.jsx`, `PayoutCalculator.jsx`
- `client/src/context/UserContext.jsx`, `RaceContext.jsx`

**Settlement logic**: Insert results -> for each pool, find winning combo -> expand all bets to check matches -> calculate parimutuel payout -> credit balances -> emit results_in socket event.

**Verify**: Two users bet on same race. Enter results. Both see payouts update live. Balances credited.

---

## Phase 4: Algorithm System

Scoring engine, top-5 bets, sleeper detection, AlgoBot player, walkthrough UI.

**Files:**
- `server/services/algorithm.js` — 6-factor scoring (0-100 scale):
  - Recent Form (25%): weighted avg of last 5 finishes
  - Speed Figures (25%): normalized last 3 speed figs
  - Jockey Win % (15%): direct scale
  - Trainer Win % (10%): direct scale
  - Post Position (10%): lookup by surface/distance
  - Class Rating (15%): bonus for class drop, penalty for rise
- `server/services/algoBot.js` — auto-places bets using top recommendations + Kelly sizing
- `server/routes/algorithm.js` — endpoints: scores, top-bets, sleepers, walkthrough, place-bets
- `client/src/pages/Algorithm.jsx` — algorithm section with sub-views
- `client/src/components/AlgoScoreCard.jsx` — per-horse score breakdown
- `client/src/components/AlgoTopBets.jsx` — top 5 recommendations
- `client/src/components/AlgoSleepers.jsx` — undervalued horses (algo rates higher than odds imply)
- `client/src/components/AlgoWalkthrough.jsx` — 5-step expandable explanation
- `client/src/components/AlgoBotBets.jsx` — bot's placed bets, tail/fade buttons

**Sleeper detection**: `valueGap = algoImpliedProb - oddsImpliedProb`. Flag if gap > 5% and score > 40.

**Verify**: Open algorithm page, see scored horses, top 5 bets, sleepers. Bot places bets visible in live feed.

---

## Phase 5: External Race Data

Pull real upcoming races from APIs.

**Files:**
- `server/services/raceDataFetcher.js` — integration with The Racing API (2-week free trial) or Horse Racing USA (RapidAPI free tier). Maps external data to local schema.
- `server/db/seed.sql` — fallback demo data (3-5 realistic races)
- `scripts/fetchRaces.js` — CLI tool to manually trigger fetch
- Update `server/routes/races.js` with `POST /api/races/fetch`

**API strategy**: Primary = The Racing API or Horse Racing USA on RapidAPI. Fallback = seed data + manual entry. Fetch on startup + every 4 hours.

**Verify**: Hit fetch endpoint, real upcoming races appear in race list.

---

## Phase 6: Polish

- `scripts/start.sh` — single command to launch server + client
- Loading states, error handling, empty states
- iPhone CSS: safe-area-inset, 44px tap targets, no hover reliance
- `.env.example` with config vars
- Test with 2-3 devices on same WiFi

---

## Verification Plan

1. Start app with `scripts/start.sh`
2. Open on iPhone via LAN IP — responsive mobile layout
3. Create 2 users on different devices
4. Create a manual race with 8 horses
5. Both users place different exotic bets — see each other's bets live
6. Enter results — payouts calculated and displayed, balances updated
7. Open algorithm page — scores, recommendations, sleepers shown
8. AlgoBot places bets — visible in feed
9. Fetch external races (if API key configured) — real races populate
