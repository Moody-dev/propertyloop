-- Read receipts: track when each participant last read the conversation.
ALTER TABLE "ConversationParticipant" ADD COLUMN "lastReadAt" TIMESTAMP(3);
