-- Create subscription_groups table
CREATE TABLE IF NOT EXISTS subscription_groups (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  UNIQUE (user_id, name)
);

-- Add group_id to subscriptions table
-- This is a safe way to add a column and a foreign key constraint in SQLite
-- Create a new table with the desired schema
CREATE TABLE subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT,
  enabled INTEGER DEFAULT 1,
  node_count INTEGER DEFAULT 0,
  last_updated TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  include_keywords TEXT,
  exclude_keywords TEXT,
  expires_at DATETIME,
  subscription_info TEXT,
  group_id TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES subscription_groups (id) ON DELETE SET NULL
);

-- Copy data from the old table to the new table
INSERT INTO subscriptions_new (id, user_id, name, url, type, enabled, node_count, last_updated, error, created_at, updated_at, include_keywords, exclude_keywords, expires_at, subscription_info)
SELECT id, user_id, name, url, type, enabled, node_count, last_updated, error, created_at, updated_at, include_keywords, exclude_keywords, expires_at, subscription_info FROM subscriptions;

-- Drop the old table
DROP TABLE subscriptions;

-- Rename the new table to the original name
ALTER TABLE subscriptions_new RENAME TO subscriptions;