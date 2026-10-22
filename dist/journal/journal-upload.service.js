import { Readable } from 'node:stream';
import { fileTypeFromBuffer } from 'file-type';
import { JournalStatus } from '@prisma/client';
import slugify from 'slugify';
import sanitizeHtml from 'sanitize-html';
import cloudinary from '../config/cloudinary.js';
import prisma from '../config/prisma.js';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
];
function validateInput(data) {
    if (!data.title?.trim() ||
        !data.excerpt?.trim() ||
        !data.content?.trim() ||
        !data.coverImage?.trim()) {
        throw new Error('Title, excerpt, content and cover image are required.');
    }
    if (data.title.trim().length > 200) {
        throw new Error('Title must not exceed 200 characters.');
    }
    if (data.excerpt.trim().length > 1000) {
        throw new Error('Excerpt must not exceed 1000 characters.');
    }
}
async function createUniqueSlug(title, excludeId) {
    const baseSlug = slugify(title, {
        lower: true,
        strict: true,
        trim: true,
    });
    if (!baseSlug) {
        throw new Error('Please provide a title that can form a URL slug.');
    }
    let slug = baseSlug;
    let suffix = 1;
    while (true) {
        const existing = await prisma.journal.findFirst({
            where: {
                slug,
                ...(excludeId ? { id: { not: excludeId } } : {}),
            },
            select: { id: true },
        });
        if (!existing)
            return slug;
        suffix += 1;
        slug = `${baseSlug}-${suffix}`;
    }
}
function cleanContent(content) {
    return sanitizeHtml(content, {
        allowedTags: [
            'h2',
            'h3',
            'h4',
            'p',
            'br',
            'strong',
            'b',
            'em',
            'i',
            'u',
            'ul',
            'ol',
            'li',
            'blockquote',
            'a',
            'img',
        ],
        allowedAttributes: {
            a: ['href', 'target', 'rel'],
            img: ['src', 'alt', 'title', 'width', 'height'],
        },
        allowedSchemes: ['http', 'https', 'mailto'],
        transformTags: {
            a: sanitizeHtml.simpleTransform('a', {
                rel: 'noopener noreferrer',
            }),
        },
    });
}
// ---------------------------------------------------------
// IMAGE UPLOAD
// ---------------------------------------------------------
export async function uploadJournalImage(file) {
    if (!file?.buffer) {
        throw new Error('Please provide an image.');
    }
    if (file.size > MAX_IMAGE_SIZE) {
        throw new Error('Image size must not exceed 5 MB.');
    }
    const detectedType = await fileTypeFromBuffer(file.buffer);
    if (!detectedType ||
        !ALLOWED_IMAGE_TYPES.includes(detectedType.mime)) {
        throw new Error('Invalid image file. Upload a valid JPEG, PNG or WebP image.');
    }
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream({
            folder: 'sculptlab/journal',
            resource_type: 'image',
            allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        }, (error, result) => {
            if (error || !result) {
                reject(error ?? new Error('Image upload failed.'));
                return;
            }
            resolve({
                url: result.secure_url,
                publicId: result.public_id,
                format: result.format,
                bytes: result.bytes,
            });
        });
        Readable.from(file.buffer).pipe(uploadStream);
    });
}
// ---------------------------------------------------------
// CREATE DRAFT
// ---------------------------------------------------------
export async function createJournal(data) {
    validateInput(data);
    const slug = await createUniqueSlug(data.title);
    return prisma.journal.create({
        data: {
            title: data.title.trim(),
            slug,
            excerpt: data.excerpt.trim(),
            content: cleanContent(data.content),
            coverImage: data.coverImage.trim(),
            authorName: data.authorName?.trim() || 'Sculpt LAB',
            status: JournalStatus.DRAFT,
            isFeatured: false,
        },
    });
}
// ---------------------------------------------------------
// GET ALL ENTRIES
// ---------------------------------------------------------
export async function getAllJournalEntries() {
    return prisma.journal.findMany({
        orderBy: {
            updatedAt: 'desc',
        },
    });
}
// ---------------------------------------------------------
// GET ONE ENTRY
// ---------------------------------------------------------
export async function getJournalById(id) {
    const journal = await prisma.journal.findUnique({
        where: { id },
    });
    if (!journal) {
        throw new Error('Journal entry not found.');
    }
    return journal;
}
// ---------------------------------------------------------
// UPDATE ENTRY
// ---------------------------------------------------------
export async function updateJournal(id, data) {
    const existing = await getJournalById(id);
    const updateData = {};
    if (data.title !== undefined) {
        if (!data.title.trim()) {
            throw new Error('Title cannot be empty.');
        }
        if (data.title.trim().length > 200) {
            throw new Error('Title must not exceed 200 characters.');
        }
        updateData.title = data.title.trim();
        if (data.title.trim() !== existing.title) {
            updateData.slug = await createUniqueSlug(data.title, id);
        }
    }
    if (data.excerpt !== undefined) {
        if (!data.excerpt.trim()) {
            throw new Error('Excerpt cannot be empty.');
        }
        if (data.excerpt.trim().length > 1000) {
            throw new Error('Excerpt must not exceed 1000 characters.');
        }
        updateData.excerpt = data.excerpt.trim();
    }
    if (data.content !== undefined) {
        if (!data.content.trim()) {
            throw new Error('Content cannot be empty.');
        }
        updateData.content = cleanContent(data.content);
    }
    if (data.coverImage !== undefined) {
        if (!data.coverImage.trim()) {
            throw new Error('Cover image cannot be empty.');
        }
        updateData.coverImage = data.coverImage.trim();
    }
    if (data.authorName !== undefined) {
        updateData.authorName =
            data.authorName.trim() || 'Sculpt LAB';
    }
    return prisma.journal.update({
        where: { id },
        data: updateData,
    });
}
// ---------------------------------------------------------
// PUBLISH ENTRY
// ---------------------------------------------------------
export async function publishJournal(id) {
    const journal = await getJournalById(id);
    if (!journal.title.trim() ||
        !journal.excerpt.trim() ||
        !journal.content.trim() ||
        !journal.coverImage.trim()) {
        throw new Error('The article needs a title, excerpt, content and cover image before publishing.');
    }
    return prisma.journal.update({
        where: { id },
        data: {
            status: JournalStatus.PUBLISHED,
            publishedAt: new Date(),
        },
    });
}
// ---------------------------------------------------------
// FEATURE ENTRY
// ---------------------------------------------------------
export async function featureJournal(id) {
    const journal = await getJournalById(id);
    if (journal.status !== JournalStatus.PUBLISHED) {
        throw new Error('Only published stories can be featured.');
    }
    return prisma.$transaction(async (tx) => {
        await tx.journal.updateMany({
            where: { isFeatured: true },
            data: { isFeatured: false },
        });
        return tx.journal.update({
            where: { id },
            data: { isFeatured: true },
        });
    });
}
// ---------------------------------------------------------
// UNPUBLISH ENTRY
// ---------------------------------------------------------
export async function unpublishJournal(id) {
    await getJournalById(id);
    return prisma.journal.update({
        where: { id },
        data: {
            status: JournalStatus.DRAFT,
            isFeatured: false,
        },
    });
}
// ---------------------------------------------------------
// DELETE ENTRY
// ---------------------------------------------------------
export async function deleteJournal(id) {
    await getJournalById(id);
    return prisma.journal.delete({
        where: { id },
    });
}
//# sourceMappingURL=journal-upload.service.js.map