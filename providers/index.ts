// providers/index.ts
// Spün Media API — Render Node.js providers backend.
// Built with Fastify. Provider routes wired in Session 2.
//
// In Session 1 this runs but all endpoints return 503.
// The scaffold is here so the Worker can already point at it.

import Fastify          from 'fastify';
import cors             from '@fastify/cors';
import { config }       from 'dotenv';

config();

const PORT   = parseInt(process.env.PORT ?? '3001');
const SECRET = process.env.X_SPUN_SECRET ?? '';

const server = Fastify({ logger: true });

// ─── CORS ─────────────────────────────────────────────────────────────────────

await server.register(cors, {
  origin: ['https://media.byspun.xyz', 'https://torii.byspun.xyz'],
});

// ─── Auth hook — all routes require X-Spun-Secret ────────────────────────────

server.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return; // health check is public

  const secret = request.headers['x-spun-secret'];
  if (!secret || secret !== SECRET) {
    return reply.code(401).send({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing X-Spun-Secret.' },
    });
  }
});

// ─── Health ───────────────────────────────────────────────────────────────────

server.get('/health', async () => ({
  status:  'ok',
  service: 'spun-media-providers',
  session: 1,
  note:    'Provider routes coming in Session 2.',
}));

// ─── Stream stub ──────────────────────────────────────────────────────────────

server.get('/stream', async (_req, reply) => {
  return reply.code(503).send({
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Stream providers not yet configured. Coming in Session 2.',
    },
  });
});

// ─── Download stub ────────────────────────────────────────────────────────────

server.get('/download', async (_req, reply) => {
  return reply.code(503).send({
    error: {
      code:    'NOT_IMPLEMENTED',
      message: 'Download providers not yet configured. Coming in Session 2.',
    },
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

try {
  await server.listen({ port: PORT, host: '0.0.0.0' });
  console.log(`[Providers] Running on port ${PORT}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
