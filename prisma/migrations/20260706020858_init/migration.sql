-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'employee');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'terminated');

-- CreateEnum
CREATE TYPE "GrantType" AS ENUM ('annual_auto', 'special');

-- CreateEnum
CREATE TYPE "LeaveUnit" AS ENUM ('full_day', 'am_half', 'pm_half');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "hire_date" DATE NOT NULL,
    "termination_date" DATE,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_grants" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "grant_type" "GrantType" NOT NULL DEFAULT 'annual_auto',
    "granted_date" DATE NOT NULL,
    "granted_days" DECIMAL(4,1) NOT NULL,
    "expire_date" DATE NOT NULL,
    "attendance_confirmed_at" TIMESTAMP(3),
    "attendance_confirmed_by" TEXT,
    "attendance_confirmed_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "target_date" DATE NOT NULL,
    "unit" "LeaveUnit" NOT NULL,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "cancelled_by" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_consumptions" (
    "id" TEXT NOT NULL,
    "leave_request_id" TEXT NOT NULL,
    "leave_grant_id" TEXT NOT NULL,
    "consumed_days" DECIMAL(4,1) NOT NULL,
    "cancelled_at" TIMESTAMP(3),

    CONSTRAINT "leave_consumptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "leave_grants_user_id_expire_date_idx" ON "leave_grants"("user_id", "expire_date");

-- CreateIndex
CREATE INDEX "leave_requests_user_id_target_date_idx" ON "leave_requests"("user_id", "target_date");

-- AddForeignKey
ALTER TABLE "leave_grants" ADD CONSTRAINT "leave_grants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_consumptions" ADD CONSTRAINT "leave_consumptions_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_consumptions" ADD CONSTRAINT "leave_consumptions_leave_grant_id_fkey" FOREIGN KEY ("leave_grant_id") REFERENCES "leave_grants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
