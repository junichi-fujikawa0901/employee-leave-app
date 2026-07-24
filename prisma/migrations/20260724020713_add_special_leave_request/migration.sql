-- CreateEnum
CREATE TYPE "SpecialLeaveType" AS ENUM ('ceremonial', 'maternity', 'childcare', 'summer');

-- CreateEnum
CREATE TYPE "SpecialLeaveRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'special_leave_request_approved';
ALTER TYPE "AuditAction" ADD VALUE 'special_leave_request_rejected';
ALTER TYPE "AuditAction" ADD VALUE 'special_leave_request_cancelled';

-- CreateTable
CREATE TABLE "special_leave_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" "SpecialLeaveType" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "SpecialLeaveRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "special_leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "special_leave_requests_user_id_type_start_date_idx" ON "special_leave_requests"("user_id", "type", "start_date");

-- AddForeignKey
ALTER TABLE "special_leave_requests" ADD CONSTRAINT "special_leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "special_leave_requests" ADD CONSTRAINT "special_leave_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
