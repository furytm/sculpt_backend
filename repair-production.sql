-- =========================================================
-- SCULPT LAB PRODUCTION DATABASE REPAIR
-- =========================================================
-- Purpose:
-- Restore the missing ClassSession table without using
-- prisma db push and without dropping existing data.
-- =========================================================


-- ---------------------------------------------------------
-- 1. Ensure SessionStatus enum exists
-- ---------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type
        WHERE typname = 'SessionStatus'
    ) THEN
        CREATE TYPE "SessionStatus" AS ENUM (
            'OPEN',
            'FULL',
            'CANCELLED',
            'COMPLETED'
        );
    END IF;
END
$$;


-- ---------------------------------------------------------
-- 2. Create ClassSession if it does not exist
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ClassSession" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClassSession_pkey"
        PRIMARY KEY ("id")
);


-- ---------------------------------------------------------
-- 3. Create ClassSession indexes
-- ---------------------------------------------------------

CREATE INDEX IF NOT EXISTS "ClassSession_sessionDate_idx"
ON "ClassSession" ("sessionDate");

CREATE INDEX IF NOT EXISTS "ClassSession_status_idx"
ON "ClassSession" ("status");

CREATE INDEX IF NOT EXISTS "ClassSession_scheduleId_idx"
ON "ClassSession" ("scheduleId");

CREATE UNIQUE INDEX IF NOT EXISTS
"ClassSession_scheduleId_sessionDate_key"
ON "ClassSession" ("scheduleId", "sessionDate");


-- ---------------------------------------------------------
-- 4. Add Schedule foreign key if it does not already exist
-- ---------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ClassSession_scheduleId_fkey'
    ) THEN

        ALTER TABLE "ClassSession"
        ADD CONSTRAINT "ClassSession_scheduleId_fkey"
        FOREIGN KEY ("scheduleId")
        REFERENCES "Schedule"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE;

    END IF;
END
$$;


-- =========================================================
-- DONE
-- =========================================================