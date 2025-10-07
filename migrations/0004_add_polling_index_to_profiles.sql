-- Add polling_index to profiles table
ALTER TABLE profiles ADD COLUMN polling_index INTEGER DEFAULT 0;