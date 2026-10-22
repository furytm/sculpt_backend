import * as publicJournalService from './journal.public.service.js';
export async function getPublishedJournals(req, res) {
    try {
        const page = Number(req.query.page ?? 1);
        const limit = Number(req.query.limit ?? 10);
        if (!Number.isInteger(page) ||
            page < 1 ||
            !Number.isInteger(limit) ||
            limit < 1) {
            res.status(400).json({
                success: false,
                message: 'Page and limit must be positive integers.',
            });
            return;
        }
        const result = await publicJournalService.getPublishedJournals(page, limit);
        res.status(200).json({
            success: true,
            message: 'Published journal entries retrieved successfully.',
            data: result.articles,
            pagination: result.pagination,
        });
    }
    catch (error) {
        console.error('Get published journals error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve journal entries.',
        });
    }
}
export async function getFeaturedJournal(_req, res) {
    try {
        const article = await publicJournalService.getFeaturedJournal();
        res.status(200).json({
            success: true,
            message: article
                ? 'Featured journal entry retrieved successfully.'
                : 'No featured journal entry is currently available.',
            data: article,
        });
    }
    catch (error) {
        console.error('Get featured journal error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve the featured journal entry.',
        });
    }
}
export async function getPublishedJournalBySlug(req, res) {
    try {
        const slug = req.params.slug;
        if (typeof slug !== 'string' || !slug.trim()) {
            res.status(400).json({
                success: false,
                message: 'A valid journal slug is required.',
            });
            return;
        }
        const article = await publicJournalService.getPublishedJournalBySlug(slug);
        if (!article) {
            res.status(404).json({
                success: false,
                message: 'Published journal entry not found.',
            });
            return;
        }
        res.status(200).json({
            success: true,
            message: 'Journal entry retrieved successfully.',
            data: article,
        });
    }
    catch (error) {
        console.error('Get journal by slug error:', error);
        res.status(500).json({
            success: false,
            message: 'Unable to retrieve the journal entry.',
        });
    }
}
//# sourceMappingURL=journal.public.controller.js.map