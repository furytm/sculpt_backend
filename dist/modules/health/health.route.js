import { Router } from 'express';
import { getHealth } from './health.controller.js';
// Routes wire paths to controllers - no logic lives here.
export const healthRouter = Router();
healthRouter.get('/health', getHealth);
//# sourceMappingURL=health.route.js.map