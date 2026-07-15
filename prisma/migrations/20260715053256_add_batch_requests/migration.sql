-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "batch_id" TEXT;

-- CreateIndex
CREATE INDEX "leave_requests_batch_id_idx" ON "leave_requests"("batch_id");
