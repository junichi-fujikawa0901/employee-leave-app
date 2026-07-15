-- AlterEnum
ALTER TYPE "LeaveUnit" ADD VALUE 'hourly';

-- AlterTable
ALTER TABLE "leave_consumptions" ALTER COLUMN "consumed_days" SET DATA TYPE DECIMAL(6,3);

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "hours" INTEGER;
