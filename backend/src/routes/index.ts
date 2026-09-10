import { Router } from 'express';
import { v1 } from './v1/index.js';

export const apiRouter = Router();

apiRouter.use('/api/v1', v1);

export default apiRouter;