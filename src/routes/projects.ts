import { Hono } from 'hono';
import { createProject, listProjects } from '../lib/projects/service';
import { createDb } from '../lib/db/client';
import { zValidator } from '../lib/validation/zod-validation';
import { createProjectSchema, listProjectsQuerySchema } from '../lib/validation/projects';
import { createdResponse, successResponse } from '../lib/http/api-response';
import { authMiddleware } from '../lib/auth/middleware';

type Bindings = CloudflareBindings;
type Variables = {
  auth: { keyId: string; projectId: string };
};

const projectsRoute = new Hono<{ Bindings: Bindings; Variables: Variables }>();

projectsRoute.use('*', authMiddleware);

projectsRoute.post('/', zValidator('json', createProjectSchema), async (c) => {
  const input = c.req.valid('json');
  const db = createDb(c.env.DB);
  const project = await createProject(db, input);
  return createdResponse(c, project);
});

projectsRoute.get('/', zValidator('query', listProjectsQuerySchema), async (c) => {
  const query = c.req.valid('query');
  const db = createDb(c.env.DB);
  const result = await listProjects(db, query);
  // Return paginated shape via successResponse for consistency with spec (JSend)
  return successResponse(c, result);
});

export default projectsRoute;
