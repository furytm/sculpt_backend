-- CreateTable
CREATE TABLE "MemberSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberSchedule_userId_idx" ON "MemberSchedule"("userId");

-- CreateIndex
CREATE INDEX "MemberSchedule_bookingId_idx" ON "MemberSchedule"("bookingId");

-- CreateIndex
CREATE INDEX "MemberSchedule_scheduleId_idx" ON "MemberSchedule"("scheduleId");

-- CreateIndex
CREATE INDEX "MemberSchedule_classId_idx" ON "MemberSchedule"("classId");

-- CreateIndex
CREATE INDEX "MemberSchedule_isActive_idx" ON "MemberSchedule"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "MemberSchedule_bookingId_scheduleId_key" ON "MemberSchedule"("bookingId", "scheduleId");

-- AddForeignKey
ALTER TABLE "MemberSchedule" ADD CONSTRAINT "MemberSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSchedule" ADD CONSTRAINT "MemberSchedule_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberSchedule" ADD CONSTRAINT "MemberSchedule_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "Schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
