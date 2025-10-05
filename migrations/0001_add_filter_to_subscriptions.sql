-- Migration number: 0001 	 2025-10-04T09:00:20.809Z
ALTER TABLE subscriptions ADD COLUMN include_keywords TEXT;
ALTER TABLE subscriptions ADD COLUMN exclude_keywords TEXT;
