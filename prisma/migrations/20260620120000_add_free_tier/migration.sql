-- AlterEnum
-- Adds the FREE subscription tier (default for new agents, capped at 3 active listings).
ALTER TYPE "SubscriptionTier" ADD VALUE 'FREE';
