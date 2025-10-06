-- Migration generated at: 2025-10-06T07:31:00Z
-- Based on user feedback and debugging session

-- 1. Delete incorrect or unnecessary mappings
DELETE FROM ua_mappings WHERE ua_keyword IN ('v2rayng', 'shadowrocket');

-- 2. Add new correct mappings
INSERT OR IGNORE INTO ua_mappings (ua_keyword, client_type, is_enabled) VALUES ('mihomo', 'clash', 1);
INSERT OR IGNORE INTO ua_mappings (ua_keyword, client_type, is_enabled) VALUES ('nekobox', 'sing-box', 1);

-- 3. Ensure stash mapping exists (it should, but this makes the migration robust)
INSERT OR IGNORE INTO ua_mappings (ua_keyword, client_type, is_enabled) VALUES ('stash', 'clash', 1);
