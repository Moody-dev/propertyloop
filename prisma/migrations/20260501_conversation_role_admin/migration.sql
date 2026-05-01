-- Add ADMIN to ConversationParticipantRole so admins can be conversation
-- participants (admin-to-user messaging from the admin console).
ALTER TYPE "ConversationParticipantRole" ADD VALUE 'ADMIN';
