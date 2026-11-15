-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_last_used_step" INTEGER,
ADD COLUMN     "mfa_pending_secret" TEXT,
ADD COLUMN     "mfa_recovery_codes" TEXT[] DEFAULT ARRAY[]::TEXT[];
