-- Add expires_at and subscription_info to subscriptions table
ALTER TABLE subscriptions ADD COLUMN expires_at DATETIME;
ALTER TABLE subscriptions ADD COLUMN subscription_info TEXT;