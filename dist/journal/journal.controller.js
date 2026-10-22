import * as journalService from './journal-upload.service.js';
// ---------------------------------------------------------
// SHARED ERROR HANDLER
// ---------------------------------------------------------
function sendError(res, error) {
    const message = error instanceof Error
        ? error.message
        : 'Journal request failed.';
    const status = message === 'Journal entry not found.' ? 404 : 400;
    return res.status(status).json({
        success: false,
        message,
    });
}
// ---------------------------------------------------------
// VALIDATE JOURNAL ID
// ---------------------------------------------------------
function getJournalId(req, res) {
    const id = req.params.id;
    if (typeof id !== 'string' || !id.trim()) {
        res.status(400).json({
            success: false,
            message: 'A valid journal ID is required.',
        });
        return null;
    }
    return id;
}
// ---------------------------------------------------------
// UPLOAD IMAGE
// ---------------------------------------------------------
export async function uploadImage(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please select an image to upload.',
            });
        }
        const image = await journalService.uploadJournalImage(req.file);
        return res.status(201).json({
            success: true,
            message: 'Image uploaded successfully.',
            data: image,
        });
    }
    catch (error) {
        console.error('Journal image upload error:', error);
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// CREATE DRAFT
// ---------------------------------------------------------
export async function createJournal(req, res) {
    try {
        const journal = await journalService.createJournal(req.body);
        return res.status(201).json({
            success: true,
            message: 'Draft created successfully.',
            data: journal,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// GET ALL JOURNAL ENTRIES
// ---------------------------------------------------------
export async function getAllJournalEntries(_req, res) {
    try {
        const journals = await journalService.getAllJournalEntries();
        return res.status(200).json({
            success: true,
            data: journals,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// GET ONE JOURNAL ENTRY
// ---------------------------------------------------------
export async function getJournalById(req, res) {
    const id = getJournalId(req, res);
    if (!id)
        return;
    try {
        const journal = await journalService.getJournalById(id);
        return res.status(200).json({
            success: true,
            data: journal,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// UPDATE JOURNAL ENTRY
// ---------------------------------------------------------
export async function updateJournal(req, res) {
    const id = getJournalId(req, res);
    if (!id)
        return;
    try {
        const journal = await journalService.updateJournal(id, req.body);
        return res.status(200).json({
            success: true,
            message: 'Journal updated successfully.',
            data: journal,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// PUBLISH JOURNAL
// ---------------------------------------------------------
export async function publishJournal(req, res) {
    const id = getJournalId(req, res);
    if (!id)
        return;
    try {
        const journal = await journalService.publishJournal(id);
        return res.status(200).json({
            success: true,
            message: 'Journal published successfully.',
            data: journal,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// FEATURE JOURNAL
// ---------------------------------------------------------
export async function featureJournal(req, res) {
    const id = getJournalId(req, res);
    if (!id)
        return;
    try {
        const journal = await journalService.featureJournal(id);
        return res.status(200).json({
            success: true,
            message: 'Featured story updated successfully.',
            data: journal,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// UNPUBLISH JOURNAL
// ---------------------------------------------------------
export async function unpublishJournal(req, res) {
    const id = getJournalId(req, res);
    if (!id)
        return;
    try {
        const journal = await journalService.unpublishJournal(id);
        return res.status(200).json({
            success: true,
            message: 'Journal unpublished successfully.',
            data: journal,
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
// ---------------------------------------------------------
// DELETE JOURNAL
// ---------------------------------------------------------
export async function deleteJournal(req, res) {
    const id = getJournalId(req, res);
    if (!id)
        return;
    try {
        await journalService.deleteJournal(id);
        return res.status(200).json({
            success: true,
            message: 'Journal deleted successfully.',
        });
    }
    catch (error) {
        return sendError(res, error);
    }
}
//# sourceMappingURL=journal.controller.js.map