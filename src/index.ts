import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { successResponse } from './lib/http/api-response';
import { toApiError } from './lib/http/error-mapper';
import { AppError } from './lib/core/errors';
import projectsRoute from './routes/projects';
import uploadsRoute from './routes/uploads';
import assetsRoute from './routes/assets';
import { rateLimit } from './lib/rate-limit';

type AppBindings = CloudflareBindings;
type AppVariables = {
  auth: { keyId: string; projectId: string };
};

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.use('*', secureHeaders());
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (origin === undefined || origin === '') return '';
      if (origin.endsWith('dikicodes.com') || origin.includes('localhost:5173') || origin.includes('localhost:8787')) return origin;
      return '';
    },
    allowHeaders: ['Content-Type', 'x-api-key'],
    allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  }),
);
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
app.use('/upload/*', (c, next) => rateLimit(c, next, 60, 60));
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
app.use('/assets/*', (c, next) => rateLimit(c, next, 60, 60));
// eslint-disable-next-line @typescript-eslint/no-unsafe-argument
app.use('/projects/*', (c, next) => rateLimit(c, next, 60, 60));

app.get('/', (c) => {
  return successResponse(c, {
    message: 'Upload Dewek API is running',
  });
});

app.get('/health', async (c) => {
  try {
    const db = (c.env as unknown as { DB?: { prepare: (q: string) => { first: () => Promise<unknown> } } }).DB;
    if (db !== undefined) {
      await db.prepare('SELECT 1').first();
    }
    return c.json({ status: 'ok', checks: { db: true } }, 200);
  } catch {
    return c.json({ status: 'degraded', checks: { db: false } }, 503);
  }
});

app.get('/healthz', (c) => c.text('ok', 200));

app.route('/projects', projectsRoute);
app.route('/upload', uploadsRoute);
app.route('/assets', assetsRoute);

app.notFound((c) => {
  const err = new AppError({
    statusCode: 404,
    message: 'Endpoint not found',
    code: 'ERR_NOT_FOUND',
    expose: true,
  });
  const { statusCode, body } = toApiError(err);
  return c.json(body, statusCode);
});

app.onError((error, c) => {
  const normalizedError = toApiError(error);
  return c.json(normalizedError.body, normalizedError.statusCode);
});

export default app;
