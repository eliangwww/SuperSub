-- Migration: Add fallback fields to profiles table
-- This migration adds columns to support the subscription polling fallback mechanism.

-- Add last_successful_subscription_id
ALTER TABLE profiles ADD COLUMN last_successful_subscription_id TEXT;

-- Add last_successful_subscription_content
ALTER TABLE profiles ADD COLUMN last_successful_subscription_content TEXT;

-- Add last_successful_subscription_updated_at
ALTER TABLE profiles ADD COLUMN last_successful_subscription_updated_at TEXT;