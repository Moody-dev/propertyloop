-- Video posts on the community feed. Capped at one per post in the DTO and
-- mutually exclusive with images, so the post card renders either a photo
-- collage or a single clip, never both.

-- AlterTable
ALTER TABLE "FeedPost" ADD COLUMN "videos" TEXT[] DEFAULT ARRAY[]::TEXT[];
