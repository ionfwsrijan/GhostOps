import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config.js';
import { setupRoutes } from './routes/index.js';
import { sseManager } from './services/sseService.js';

const app = express();

app.use(helmet({
  contentSecurityPolicy: false,
}));
app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ghostops-backend', time: new Date().toISOString() });
});

setupRoutes(app);

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const server = app.listen(config.port, () => {
  console.log(`[ghostops] backend running on http://localhost:${config.port}`);
  console.log(`[ghostops] SSE endpoint: http://localhost:${config.port}/api/events`);
});

// Graceful shutdown — close SSE streams
process.on('SIGINT', () => {
  console.log('\n[ghostops] shutting down...');
  sseManager.broadcast({ type: 'server_shutdown', data: { message: 'GhostOps backend is shutting down' } });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000);
});