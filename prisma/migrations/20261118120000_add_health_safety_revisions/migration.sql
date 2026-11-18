-- CreateTable
CREATE TABLE "HealthSafetyRevision" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "formId" TEXT,
    "userId" TEXT,
    "bookingId" TEXT,
    "accepted" BOOLEAN NOT NULL,
    "notes" TEXT,
    "declarationVersion" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthSafetyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthSafetyRevision_formId_createdAt_idx" ON "HealthSafetyRevision"("formId", "createdAt");

-- CreateIndex
CREATE INDEX "HealthSafetyRevision_userId_kind_createdAt_idx" ON "HealthSafetyRevision"("userId", "kind", "createdAt");

-- AddForeignKey
ALTER TABLE "HealthSafetyRevision" ADD CONSTRAINT "HealthSafetyRevision_formId_fkey" FOREIGN KEY ("formId") REFERENCES "HealthSafetyForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSafetyRevision" ADD CONSTRAINT "HealthSafetyRevision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill:start
-- One BACKFILL revision per existing HealthSafetyForm, so the history
-- starts with the declarations already in the database. Read-only on
-- existing tables. The member is the form's user or, for forms not yet
-- linked to an account, the booking's user. Its time is the declaration's
-- own submission time.
INSERT INTO "HealthSafetyRevision" (
    "id", "kind", "formId", "userId", "bookingId",
    "accepted", "notes", "declarationVersion", "acceptedAt", "submittedAt",
    "source", "actorType", "actorUserId", "createdAt"
)
SELECT
    'hsr_' || replace(gen_random_uuid()::text, '-', ''),
    'BOOKING',
    f."id",
    COALESCE(f."userId", b."userId"),
    f."bookingId",
    f."accepted",
    f."notes",
    f."declarationVersion",
    f."acceptedAt",
    f."submittedAt",
    'BACKFILL',
    'SYSTEM',
    NULL,
    COALESCE(f."submittedAt", f."updatedAt", f."createdAt")
FROM "HealthSafetyForm" f
LEFT JOIN "Booking" b ON b."id" = f."bookingId";
-- Backfill:end
