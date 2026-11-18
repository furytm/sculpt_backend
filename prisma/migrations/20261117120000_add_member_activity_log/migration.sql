-- CreateTable
CREATE TABLE "MemberActivityLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "subjectEmail" TEXT,
    "actorType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "httpStatus" INTEGER,
    "entityType" TEXT,
    "entityId" TEXT,
    "paymentReference" TEXT,
    "correlationId" TEXT,
    "requestId" TEXT,
    "dedupeKey" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberActivityLog_dedupeKey_key" ON "MemberActivityLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "MemberActivityLog_userId_createdAt_idx" ON "MemberActivityLog"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MemberActivityLog_status_createdAt_idx" ON "MemberActivityLog"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MemberActivityLog_action_createdAt_idx" ON "MemberActivityLog"("action", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MemberActivityLog_correlationId_idx" ON "MemberActivityLog"("correlationId");

-- CreateIndex
CREATE INDEX "MemberActivityLog_paymentReference_idx" ON "MemberActivityLog"("paymentReference");

-- CreateIndex
CREATE INDEX "MemberActivityLog_entityType_entityId_idx" ON "MemberActivityLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "MemberActivityLog_createdAt_idx" ON "MemberActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "MemberActivityLog" ADD CONSTRAINT "MemberActivityLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

