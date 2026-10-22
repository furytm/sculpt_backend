import prisma from '../config/prisma.js';
const publicJournalSelect = {
    id: true,
    title: true,
    slug: true,
    excerpt: true,
    content: true,
    coverImage: true,
    authorName: true,
    isFeatured: true,
    publishedAt: true,
    createdAt: true,
    updatedAt: true,
};
export async function getPublishedJournals(page = 1, limit = 10) {
    const safePage = Math.max(1, Math.floor(page));
    const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
    const skip = (safePage - 1) * safeLimit;
    const where = {
        status: 'PUBLISHED',
    };
    const [articles, total] = await prisma.$transaction([
        prisma.journal.findMany({
            where,
            select: publicJournalSelect,
            orderBy: [
                { publishedAt: 'desc' },
                { createdAt: 'desc' },
            ],
            skip,
            take: safeLimit,
        }),
        prisma.journal.count({ where }),
    ]);
    return {
        articles,
        pagination: {
            page: safePage,
            limit: safeLimit,
            total,
            totalPages: Math.ceil(total / safeLimit),
        },
    };
}
export async function getFeaturedJournal() {
    return prisma.journal.findFirst({
        where: {
            status: 'PUBLISHED',
            isFeatured: true,
        },
        select: publicJournalSelect,
        orderBy: {
            publishedAt: 'desc',
        },
    });
}
export async function getPublishedJournalBySlug(slug) {
    return prisma.journal.findFirst({
        where: {
            slug,
            status: 'PUBLISHED',
        },
        select: publicJournalSelect,
    });
}
//# sourceMappingURL=journal.public.service.js.map