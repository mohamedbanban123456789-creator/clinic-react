-- CreateEnum
CREATE TYPE "CallRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'CALL_REQUEST_CREATE';
ALTER TYPE "AuditAction" ADD VALUE 'CALL_REQUEST_APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'CALL_REQUEST_CANCEL';

-- CreateTable
CREATE TABLE "call_requests" (
    "id" TEXT NOT NULL,
    "queue_entry_id" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "status" "CallRequestStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "call_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_pending_call_request" ON "call_requests"("queue_entry_id") WHERE status = 'PENDING';

-- CreateIndex
CREATE INDEX "call_requests_queue_entry_id_status_idx" ON "call_requests"("queue_entry_id", "status");

-- CreateIndex
CREATE INDEX "call_requests_status_idx" ON "call_requests"("status");

-- AddForeignKey
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_requests" ADD CONSTRAINT "call_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
