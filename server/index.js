import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import db from './db/connection.js';
import { createUsersRouter } from './routes/users.js';
import { createRacesRouter } from './routes/races.js';
import { createAlgorithmRouter } from './routes/algorithm.js';
import { createBetsRouter } from './routes/bets.js';
import { createJockeysRouter } from './routes/jockeys.js';
import { registerSocketHandlers } from './socket/handler.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(currentDir, '..');
const clientDistDir = path.join(rootDir, 'client', 'dist');
const clientIndexPath = path.join(clientDistDir, 'index.html');
const hasClientBuild = fs.existsSync(clientIndexPath);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*'
  }
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ?? '*'
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  const row = db.prepare('SELECT COUNT(1) AS count FROM races').get();
  res.json({
    ok: true,
    service: 'horse-race-demo-server',
    raceCount: row.count,
    now: new Date().toISOString()
  });
});

app.use('/api/users', createUsersRouter(io));
app.use('/api/races', createRacesRouter(io));
app.use('/api/algorithm', createAlgorithmRouter());
app.use('/api/jockeys', createJockeysRouter());
app.use('/api', createBetsRouter(io));

if (hasClientBuild) {
  app.use(express.static(clientDistDir));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    return res.sendFile(clientIndexPath);
  });
}

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(500).json({ error: 'Internal server error.' });
});

registerSocketHandlers(io);

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`API ready on http://${host}:${port}`);
});
