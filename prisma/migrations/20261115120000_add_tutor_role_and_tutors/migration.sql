-- Tutor role and tutors.
-- Additive only: a new enum value, a new Tutor table, and a nullable
-- Schedule.tutorId. No existing rows or columns change.
-- Schedules are linked to tutors afterwards by prisma/create-tutors.ts.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'TUTOR';

-- AlterTable
ALTER TABLE "Schedule" ADD COLUMN     "tutorId" TEXT;

-- CreateTable
CREATE TABLE "Tutor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tutor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_name_key" ON "Tutor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tutor_userId_key" ON "Tutor"("userId");

-- CreateIndex
CREATE INDEX "Schedule_tutorId_idx" ON "Schedule"("tutorId");

-- AddForeignKey
ALTER TABLE "Schedule" ADD CONSTRAINT "Schedule_tutorId_fkey" FOREIGN KEY ("tutorId") REFERENCES "Tutor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tutor" ADD CONSTRAINT "Tutor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

