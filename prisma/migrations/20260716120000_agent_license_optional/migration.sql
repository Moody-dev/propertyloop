-- Make agent license/registration (RC) number optional to lower the signup
-- barrier. The unique index is retained; Postgres treats NULLs as distinct,
-- so multiple agents without a number coexist without collision.

-- AlterTable
ALTER TABLE "AgentProfile" ALTER COLUMN "licenseNumber" DROP NOT NULL;
