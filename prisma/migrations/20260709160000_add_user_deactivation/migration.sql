-- Self-service account deactivation (reversible, distinct from admin
-- suspension via isActive and permanent soft-delete via deletedAt).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "deactivatedAt" TIMESTAMP(3);
