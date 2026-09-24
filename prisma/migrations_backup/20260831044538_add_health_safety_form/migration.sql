-- CreateTable
CREATE TABLE "HealthSafetyForm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "age" INTEGER,
    "emergencyContactName" TEXT,
    "emergencyContactRelationship" TEXT,
    "emergencyContactPhone" TEXT,
    "pregnancy" TEXT,
    "pregnancyWeeks" INTEGER,
    "dueDate" TIMESTAMP(3),
    "pregnancyClearance" TEXT,
    "postpartum" TEXT,
    "deliveryDate" TIMESTAMP(3),
    "postpartumClearance" TEXT,
    "screeningAnswers" JSONB,
    "surgery" TEXT,
    "surgeryDetails" TEXT,
    "surgeryClearance" TEXT,
    "consent" JSONB,
    "signature" TEXT,
    "signatureDate" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthSafetyForm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HealthSafetyForm_bookingId_key" ON "HealthSafetyForm"("bookingId");

-- CreateIndex
CREATE INDEX "HealthSafetyForm_userId_idx" ON "HealthSafetyForm"("userId");

-- AddForeignKey
ALTER TABLE "HealthSafetyForm" ADD CONSTRAINT "HealthSafetyForm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthSafetyForm" ADD CONSTRAINT "HealthSafetyForm_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
