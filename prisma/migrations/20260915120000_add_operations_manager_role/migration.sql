-- Operations Manager.
--
-- A position above Operations & Customer Relationship: runs the operations
-- queue and the people working it. Adding an enum value changes nothing that
-- already exists, so this is safe against live data.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'OPERATIONS_MANAGER' AFTER 'OPERATIONS';
