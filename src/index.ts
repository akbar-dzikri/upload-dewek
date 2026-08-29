import { Hono } from 'hono';
import { successResponse } from './lib/http/api-response';
import { toApiError } from './lib/http/error-mapper';
import { AppError } from './lib/core/errors';
import projectsRoute from './routes/projects';

type AppBindings = CloudflareBindings;
type AppVariables = {
  auth: { keyId: string; projectId: string };
};

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

app.get('/', (c) => {
  return successResponse(c, {
    message: 'Upload Dewek API is running',
  });
});

app.route('/projects', projectsRoute);

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
