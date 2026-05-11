/*
  Warnings:

  - You are about to drop the column `imageUrl` on the `FeaturedProperty` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "FeaturedProperty" DROP COLUMN "imageUrl",
ADD COLUMN     "imageUrls" TEXT[];
