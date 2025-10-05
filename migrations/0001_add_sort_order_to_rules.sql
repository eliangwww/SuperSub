-- Migration number: 0001 	 2025-10-05T07:27:58.931Z
ALTER TABLE subscription_rules ADD COLUMN sort_order INTEGER DEFAULT 0;
