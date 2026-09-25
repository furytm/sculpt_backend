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
-- ADD MISSING BOOKING COLUMNS
-- =========================================================

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "sessionId" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "classId" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "bookingFlowTokenHash" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "calendarEventId" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "calendarEventUrl" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "memberMembershipId" TEXT;

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "preferredStartDate" TIMESTAMP(3);

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "availableDays" TEXT[];

ALTER TABLE "Booking"
ADD COLUMN IF NOT EXISTS "preferredTimes" TEXT[];

CREATE INDEX IF NOT EXISTS "Booking_sessionId_idx"
ON "Booking" ("sessionId");

CREATE INDEX IF NOT EXISTS "Booking_memberMembershipId_idx"
ON "Booking" ("memberMembershipId");

CREATE INDEX IF NOT EXISTS "Booking_userId_idx"
ON "Booking" ("userId");

CREATE INDEX IF NOT EXISTS "Booking_bookingStatus_idx"
ON "Booking" ("bookingStatus");
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'Booking_sessionId_fkey'
    ) THEN

        ALTER TABLE "Booking"
        ADD CONSTRAINT "Booking_sessionId_fkey"
        FOREIGN KEY ("sessionId")
        REFERENCES "ClassSession"("id")
        ON DELETE SET NULL
        ON UPDATE CASCADE;

    END IF;
END
$$;

-- =========================================================
-- ADD MISSING MEMBER MEMBERSHIP CREDIT COLUMNS
-- =========================================================

ALTER TABLE "MemberMembership"
ADD COLUMN IF NOT EXISTS "creditsTotal" INTEGER;

ALTER TABLE "MemberMembership"
ADD COLUMN IF NOT EXISTS "creditsUsed" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "MemberMembership_userId_idx"
ON "MemberMembership" ("userId");

CREATE INDEX IF NOT EXISTS "MemberMembership_status_idx"
ON "MemberMembership" ("status");

CREATE INDEX IF NOT EXISTS "MemberMembership_expiryDate_idx"
ON "MemberMembership" ("expiryDate");


-- =========================================================
-- DONE
-- =========================================================