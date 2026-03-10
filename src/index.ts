import { Hono } from 'hono';
import { errorResponse, successResponse } from './lib/http/api-response';
import { toApiError } from './lib/http/app-error';

const app = new Hono();

app.get('/', (c) => {
  return successResponse(c, {
    message: 'Upload Dewek API is running',
  });
});

app.notFound((c) => {
  return errorResponse(c, 'Endpoint not found', 'ERR_NOT_FOUND', 404);
});

app.onError((error, c) => {
  const normalizedError = toApiError(error);
  return c.json(normalizedError.body, normalizedError.statusCode);
});

export default app;
