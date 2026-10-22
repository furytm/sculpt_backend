import { Router } from 'express';
import { getFeaturedJournal, getPublishedJournalBySlug, getPublishedJournals, } from './journal.public.controller.js';
const router = Router();
// Public routes: no admin authentication middleware here.
router.get('/', getPublishedJournals);
router.get('/featured', getFeaturedJournal);
router.get('/:slug', getPublishedJournalBySlug);
export default router;
//# sourceMappingURL=journal.public.routes.js.map