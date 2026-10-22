import { Router } from 'express';
import multer from 'multer';
import authenticate from '../middleware/authenticate.js';
import requireAdmin from '../middleware/requireAdmin.js';
import { createJournal, getAllJournalEntries, getJournalById, updateJournal, publishJournal, featureJournal, unpublishJournal, deleteJournal, } from './journal.controller.js';
import { journalImageUpload } from '../middleware/journalUpload.js';
import { uploadImage } from './journal.controller.js';
const router = Router();
function handleJournalUploadError(error, _req, res, next) {
    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: error.code === 'LIMIT_FILE_SIZE'
                ? 'Image size must not exceed 5 MB.'
                : 'Invalid image upload.',
        });
    }
    if (error instanceof Error) {
        return res.status(400).json({
            success: false,
            message: error.message,
        });
    }
    next(error);
}
// All routes in this router require an authenticated admin.
router.use(authenticate, requireAdmin);
// Image upload
router.post('/upload-image', journalImageUpload.single('image'), uploadImage);
// Create and list
router.post('/', createJournal);
router.get('/', getAllJournalEntries);
// Get and update one entry
router.get('/:id', getJournalById);
router.patch('/:id', updateJournal);
// Publishing actions
router.patch('/:id/publish', publishJournal);
router.patch('/:id/feature', featureJournal);
router.patch('/:id/unpublish', unpublishJournal);
// Permanent deletion
router.delete('/:id', deleteJournal);
export default router;
//# sourceMappingURL=journal.routes.js.map