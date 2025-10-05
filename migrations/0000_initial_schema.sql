-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Seed a special system user for global assets
INSERT OR IGNORE INTO users (id, username, password, role, created_at, updated_at) VALUES ('system-user-001', '_system_', 'N/A', 'system', '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');

-- Create node_groups table
CREATE TABLE IF NOT EXISTS node_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Create nodes table
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  group_id TEXT, -- Can be subscription_id or a manual group
  name TEXT NOT NULL,
  link TEXT, -- The original share link, can be NULL if built manually
  protocol TEXT NOT NULL, -- e.g., 'vmess', 'ss', 'hysteria2'
  protocol_params TEXT, -- JSON object for protocol-specific params
  
  -- Legacy fields, kept for compatibility and simple queries
  server TEXT,
  port INTEGER,
  password TEXT,
  type TEXT, -- Often duplicates 'protocol', for legacy support
  params TEXT, -- Often duplicates 'protocol_params', for legacy support

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_order INTEGER,
  status TEXT DEFAULT 'pending', -- 'pending', 'testing', 'healthy', 'unhealthy'
  latency INTEGER,
  last_checked TEXT,
  error TEXT,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  node_count INTEGER DEFAULT 0,
  last_updated TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id)
);

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  alias TEXT,
  description TEXT,
  -- Generation settings
  generation_mode TEXT NOT NULL DEFAULT 'online', -- 'local' or 'online'
  template_id INTEGER, -- FK to config_templates.id, for 'local' mode
  subconverter_backend_id INTEGER, -- FK to subconverter_assets.id, for 'online' mode
  subconverter_config_id INTEGER, -- FK to subconverter_assets.id, for 'online' mode
  template_variables TEXT, -- JSON object for template variables
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id),
  FOREIGN KEY (subconverter_backend_id) REFERENCES subconverter_assets (id),
  FOREIGN KEY (subconverter_config_id) REFERENCES subconverter_assets (id),
  UNIQUE (user_id, alias)
);

-- Create profile_nodes table
CREATE TABLE IF NOT EXISTS profile_nodes (
  profile_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, node_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (id),
  FOREIGN KEY (node_id) REFERENCES nodes (id)
);

-- Create profile_subscriptions table
CREATE TABLE IF NOT EXISTS profile_subscriptions (
  profile_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  PRIMARY KEY (profile_id, subscription_id),
  FOREIGN KEY (profile_id) REFERENCES profiles (id),
  FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
);

-- Create subscription_rules table
CREATE TABLE IF NOT EXISTS subscription_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subscription_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

-- Create index for subscription_rules
CREATE INDEX IF NOT EXISTS idx_subscription_rules_subscription_id ON subscription_rules(subscription_id);

-- Create trigger for subscription_rules
CREATE TRIGGER IF NOT EXISTS trigger_subscription_rules_updated_at
AFTER UPDATE ON subscription_rules
FOR EACH ROW
BEGIN
    UPDATE subscription_rules SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;


-- Create settings table
CREATE TABLE IF NOT EXISTS settings (
  key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value TEXT,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (key, user_id),
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Create the config_templates table
-- This table stores user-defined templates for generating client-specific configuration files.
CREATE TABLE IF NOT EXISTS `config_templates` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `name` TEXT NOT NULL,
    `client_type` TEXT NOT NULL CHECK(`client_type` IN ('CLASH', 'SURGE', 'V2RAYN', 'QUANTUMULT_X', 'GENERIC')),
    `content` TEXT NOT NULL,
    `subscription_ids` TEXT DEFAULT '[]', -- JSON array of subscription IDs
    `user_id` TEXT,
    `is_system` INTEGER DEFAULT 0,
    `created_at` TEXT DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Create an index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS `idx_config_templates_user_id` ON `config_templates` (`user_id`);
CREATE INDEX IF NOT EXISTS `idx_config_templates_is_system` ON `config_templates` (`is_system`);

-- Create subconverter_assets table
CREATE TABLE IF NOT EXISTS subconverter_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('backend', 'config')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_subconverter_assets_user_id ON subconverter_assets(user_id);

CREATE TRIGGER IF NOT EXISTS trigger_subconverter_assets_updated_at
AFTER UPDATE ON subconverter_assets
FOR EACH ROW
BEGIN
    UPDATE subconverter_assets SET updated_at = CURRENT_TIMESTAMP WHERE id = OLD.id;
END;

-- Table for storing subscription processing logs
CREATE TABLE IF NOT EXISTS `subscription_processing_logs` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `run_id` TEXT NOT NULL,
    `profile_id` TEXT NOT NULL,
    `step_name` TEXT NOT NULL,
    `step_order` INTEGER NOT NULL,
    `input_count` INTEGER NOT NULL,
    `output_count` INTEGER NOT NULL,
    `details` TEXT, -- JSON object for extra details
    `created_at` TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`profile_id`) REFERENCES `profiles` (`id`) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS `idx_sub_logs_run_id` ON `subscription_processing_logs` (`run_id`);
CREATE INDEX IF NOT EXISTS `idx_sub_logs_profile_id` ON `subscription_processing_logs` (`profile_id`);

-- Create a trigger to automatically update the updated_at timestamp
CREATE TRIGGER IF NOT EXISTS `trigger_config_templates_update_updated_at`
AFTER UPDATE ON `config_templates`
FOR EACH ROW
BEGIN
    UPDATE `config_templates` SET `updated_at` = CURRENT_TIMESTAMP WHERE `id` = OLD.`id`;
END;


-- Create the processing_units table
-- This table stores the individual steps (units) in a profile's processing pipeline.
CREATE TABLE IF NOT EXISTS `processing_units` (
    `id` INTEGER PRIMARY KEY AUTOINCREMENT,
    `profile_id` TEXT NOT NULL,
    `user_id` TEXT NOT NULL,
    `type` TEXT NOT NULL,
    `config` TEXT NOT NULL, -- JSON object storing the unit's specific configuration
    `order_index` INTEGER NOT NULL,
    `is_enabled` INTEGER NOT NULL DEFAULT 1,
    `created_at` TEXT DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
    FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON DELETE CASCADE
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS `idx_processing_units_profile_id` ON `processing_units` (`profile_id`);

-- Create a trigger to automatically update the updated_at timestamp
CREATE TRIGGER IF NOT EXISTS `trigger_processing_units_update_updated_at`
AFTER UPDATE ON `processing_units`
FOR EACH ROW
BEGIN
    UPDATE `processing_units` SET `updated_at` = CURRENT_TIMESTAMP WHERE `id` = OLD.`id`;
END;



-- Create system_settings table for global settings
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Seed initial system settings
INSERT OR IGNORE INTO system_settings (key, value) VALUES ('allow_registration', 'true');


-- Create ua_mappings table for adaptive subscriptions
CREATE TABLE IF NOT EXISTS ua_mappings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ua_keyword TEXT NOT NULL UNIQUE,
  client_type TEXT NOT NULL,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial UA mappings
INSERT OR IGNORE INTO ua_mappings (ua_keyword, client_type) VALUES
  ('clash', 'clash'),
  ('stash', 'clash'),
  ('shadowrocket', 'shadowrocket'),
  ('quantumult%20x', 'quantumultx'),
  ('quantumult', 'quantumult'),
  ('surge', 'surge'),
  ('surfboard', 'surfboard'),
  ('loon', 'loon'),
  ('sing-box', 'sing-box'),
  ('v2rayng', 'v2ray');


-- Seed public subconverter assets
-- user_id = 'system-user-001' indicates a system-wide, built-in asset.

-- Backends (ID 1-100)
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (1, 'system-user-001', 'CM负载均衡后端【vless reality+hy1+hy2】', 'https://subapi.cmliussss.net', 'backend');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (2, 'system-user-001', 'CM应急备用后端【vless reality+hy1+hy2】', 'https://subapi.fxxk.dedyn.io', 'backend');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (3, 'system-user-001', '肥羊增强型后端【vless reality+hy1+hy2】', 'https://url.v1.mk', 'backend');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (4, 'system-user-001', '肥羊备用后端【vless reality+hy1+hy2】', 'https://sub.d1.mk', 'backend');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (5, 'system-user-001', 'nameless13提供', 'https://www.nameless13.com', 'backend');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (6, 'system-user-001', 'subconverter作者提供', 'https://sub.xeton.dev', 'backend');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (7, 'system-user-001', 'sub-web作者提供', 'https://api.wcc.best', 'backend');

-- Remote Configs (ID 101+)

-- Group: CM规则
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (101, 'system-user-001', 'CM_Online 默认版 识别港美地区(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (102, 'system-user-001', 'CM_Online_MultiCountry 识别港美地区 负载均衡(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (103, 'system-user-001', 'CM_Online_MultiCountry_CF 识别港美地区、CloudFlareCDN 负载均衡 Worker节点专用(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_MultiCountry_CF.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (104, 'system-user-001', 'CM_Online_Full 识别多地区分组(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (105, 'system-user-001', 'CM_Online_Full_CF 识别多地区、CloudFlareCDN 分组 Worker节点专用(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_CF.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (106, 'system-user-001', 'CM_Online_Full_MultiMode 识别多地区 负载均衡(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (107, 'system-user-001', 'CM_Online_Full_MultiMode_CF 识别多地区、CloudFlareCDN 负载均衡 Worker节点专用(与Github同步)', 'https://raw.githubusercontent.com/cmliu/ACL4SSR/main/Clash/config/ACL4SSR_Online_Full_MultiMode_CF.ini', 'config');

-- Group: 通用
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (201, 'system-user-001', '默认', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_NoAuto.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (202, 'system-user-001', '默认（自动测速）', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_AdblockPlus.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (203, 'system-user-001', '默认（索尼电视专用）', 'https://raw.githubusercontent.com/youshandefeiyang/webcdn/main/SONY.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (204, 'system-user-001', '默认（附带用于 Clash 的 AdGuard DNS）', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/default_with_clash_adg.yml', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (205, 'system-user-001', 'ACL_全分组 Dream修改版', 'https://raw.githubusercontent.com/WC-Dream/ACL4SSR/WD/Clash/config/ACL4SSR_Online_Full_Dream.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (206, 'system-user-001', 'ACL_精简分组 Dream修改版', 'https://raw.githubusercontent.com/WC-Dream/ACL4SSR/WD/Clash/config/ACL4SSR_Mini_Dream.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (207, 'system-user-001', 'emby-TikTok-流媒体分组-去广告加强版', 'https://raw.githubusercontent.com/justdoiting/ClashRule/main/GeneralClashRule.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (208, 'system-user-001', '流媒体通用分组', 'https://raw.githubusercontent.com/cutethotw/ClashRule/main/GeneralClashRule.ini', 'config');

-- Group: ACL规则
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (301, 'system-user-001', 'ACL_默认版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (302, 'system-user-001', 'ACL_无测速版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_NoAuto.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (303, 'system-user-001', 'ACL_去广告版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_AdblockPlus.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (304, 'system-user-001', 'ACL_多国家版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_MultiCountry.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (305, 'system-user-001', 'ACL_无Reject版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_NoReject.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (306, 'system-user-001', 'ACL_无测速精简版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_NoAuto.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (307, 'system-user-001', 'ACL_全分组版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (308, 'system-user-001', 'ACL_全分组谷歌版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Google.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (309, 'system-user-001', 'ACL_全分组多模式版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_MultiMode.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (310, 'system-user-001', 'ACL_全分组奈飞版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Full_Netflix.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (311, 'system-user-001', 'ACL_精简版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (312, 'system-user-001', 'ACL_去广告精简版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_AdblockPlus.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (313, 'system-user-001', 'ACL_Fallback精简版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_Fallback.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (314, 'system-user-001', 'ACL_多国家精简版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_MultiCountry.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (315, 'system-user-001', 'ACL_多模式精简版', 'https://raw.githubusercontent.com/ACL4SSR/ACL4SSR/master/Clash/config/ACL4SSR_Online_Mini_MultiMode.ini', 'config');

-- Group: 全网搜集规则
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (401, 'system-user-001', '常规规则', 'https://raw.githubusercontent.com/flyhigherpi/merlinclash_clash_related/master/Rule_config/ZHANG.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (402, 'system-user-001', '酷酷自用', 'https://raw.githubusercontent.com/xiaoshenxian233/cool/rule/complex.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (403, 'system-user-001', 'PharosPro无测速', 'https://subweb.s3.fr-par.scw.cloud/RemoteConfig/special/phaors.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (404, 'system-user-001', '分区域故障转移', 'https://raw.githubusercontent.com/flyhigherpi/merlinclash_clash_related/master/Rule_config/ZHANG_Area_Fallback.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (405, 'system-user-001', '分区域自动测速', 'https://raw.githubusercontent.com/flyhigherpi/merlinclash_clash_related/master/Rule_config/ZHANG_Area_Urltest.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (406, 'system-user-001', '分区域无自动测速', 'https://raw.githubusercontent.com/flyhigherpi/merlinclash_clash_related/master/Rule_config/ZHANG_Area_NoAuto.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (407, 'system-user-001', 'OoHHHHHHH', 'https://raw.githubusercontent.com/OoHHHHHHH/ini/master/config.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (408, 'system-user-001', 'CFW-TAP', 'https://raw.githubusercontent.com/OoHHHHHHH/ini/master/cfw-tap.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (409, 'system-user-001', 'lhl77全分组（定期更新）', 'https://raw.githubusercontent.com/lhl77/sub-ini/main/tsutsu-full.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (410, 'system-user-001', 'lhl77简易版（定期更新）', 'https://raw.githubusercontent.com/lhl77/sub-ini/main/tsutsu-mini-gfw.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (411, 'system-user-001', 'ConnersHua 神机规则 Outbound', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/connershua_new.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (412, 'system-user-001', 'ConnersHua 神机规则 Inbound 回国专用', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/connershua_backtocn.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (413, 'system-user-001', 'lhie1 洞主规则（使用 Clash 分组规则）', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/lhie1_clash.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (414, 'system-user-001', 'lhie1 洞主规则完整版', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/lhie1_dler.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (415, 'system-user-001', 'eHpo1 规则', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/ehpo1_main.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (416, 'system-user-001', '多策略组默认白名单模式', 'https://raw.nameless13.com/api/public/dl/ROzQqi2S/white.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (417, 'system-user-001', '多策略组可以有效减少审计触发', 'https://raw.nameless13.com/api/public/dl/ptLeiO3S/mayinggfw.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (418, 'system-user-001', '精简策略默认白名单', 'https://raw.nameless13.com/api/public/dl/FWSh3dXz/easy3.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (419, 'system-user-001', '多策略增加SMTP策略', 'https://raw.nameless13.com/api/public/dl/L_-vxO7I/youtube.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (420, 'system-user-001', '无策略入门推荐', 'https://raw.nameless13.com/api/public/dl/zKF9vFbb/easy.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (421, 'system-user-001', '无策略入门推荐国家分组', 'https://raw.nameless13.com/api/public/dl/E69bzCaE/easy2.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (422, 'system-user-001', '无策略仅IPIP CN + Final', 'https://raw.nameless13.com/api/public/dl/XHr0miMg/ipip.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (423, 'system-user-001', '无策略魅影vip分组', 'https://raw.nameless13.com/api/public/dl/BBnfb5lD/MAYINGVIP.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (424, 'system-user-001', '品云专属配置（仅香港区域分组）', 'https://raw.githubusercontent.com/Mazeorz/airports/master/Clash/Examine.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (425, 'system-user-001', '品云专属配置（全地域分组）', 'https://raw.githubusercontent.com/Mazeorz/airports/master/Clash/Examine_Full.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (426, 'system-user-001', 'nzw9314 规则', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/nzw9314_custom.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (427, 'system-user-001', 'maicoo-l 规则', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/maicoo-l_custom.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (428, 'system-user-001', 'DlerCloud Platinum 李哥定制规则', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/dlercloud_lige_platinum.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (429, 'system-user-001', 'DlerCloud Gold 李哥定制规则', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/dlercloud_lige_gold.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (430, 'system-user-001', 'DlerCloud Silver 李哥定制规则', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/dlercloud_lige_silver.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (431, 'system-user-001', 'ProxyStorage自用', 'https://unpkg.com/proxy-script/config/Clash/clash.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (432, 'system-user-001', 'ShellClash修改版规则 (by UlinoyaPed)', 'https://github.com/UlinoyaPed/ShellClash/raw/master/rules/ShellClash.ini', 'config');

-- Group: 各大机场规则
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (501, 'system-user-001', 'EXFLUX', 'https://gist.github.com/jklolixxs/16964c46bad1821c70fa97109fd6faa2/raw/EXFLUX.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (502, 'system-user-001', 'NaNoport', 'https://gist.github.com/jklolixxs/32d4e9a1a5d18a92beccf3be434f7966/raw/NaNoport.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (503, 'system-user-001', 'CordCloud', 'https://gist.github.com/jklolixxs/dfbe0cf71ffc547557395c772836d9a8/raw/CordCloud.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (504, 'system-user-001', 'BigAirport', 'https://gist.github.com/jklolixxs/e2b0105c8be6023f3941816509a4c453/raw/BigAirport.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (505, 'system-user-001', '跑路云', 'https://gist.github.com/jklolixxs/9f6989137a2cfcc138c6da4bd4e4cbfc/raw/PaoLuCloud.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (506, 'system-user-001', 'WaveCloud', 'https://gist.github.com/jklolixxs/fccb74b6c0018b3ad7b9ed6d327035b3/raw/WaveCloud.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (507, 'system-user-001', '几鸡', 'https://gist.github.com/jklolixxs/bfd5061dceeef85e84401482f5c92e42/raw/JiJi.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (508, 'system-user-001', '四季加速', 'https://gist.github.com/jklolixxs/6ff6e7658033e9b535e24ade072cf374/raw/SJ.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (509, 'system-user-001', 'ImmTelecom', 'https://gist.github.com/jklolixxs/24f4f58bb646ee2c625803eb916fe36d/raw/ImmTelecom.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (510, 'system-user-001', 'AmyTelecom', 'https://gist.github.com/jklolixxs/b53d315cd1cede23af83322c26ce34ec/raw/AmyTelecom.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (511, 'system-user-001', 'LinkCube', 'https://subweb.s3.fr-par.scw.cloud/RemoteConfig/customized/convenience.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (512, 'system-user-001', 'Miaona', 'https://gist.github.com/jklolixxs/ff8ddbf2526cafa568d064006a7008e7/raw/Miaona.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (513, 'system-user-001', 'Foo&Friends', 'https://gist.github.com/jklolixxs/df8fda1aa225db44e70c8ac0978a3da4/raw/Foo&Friends.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (514, 'system-user-001', 'ABCloud', 'https://gist.github.com/jklolixxs/b1f91606165b1df82e5481b08fd02e00/raw/ABCloud.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (515, 'system-user-001', '咸鱼', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/customized/xianyu.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (516, 'system-user-001', '便利店', 'https://subweb.oss-cn-hongkong.aliyuncs.com/RemoteConfig/customized/convenience.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (517, 'system-user-001', 'CNIX', 'https://raw.githubusercontent.com/Mazeorz/airports/master/Clash/SSRcloud.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (518, 'system-user-001', 'Nirvana', 'https://raw.githubusercontent.com/Mazetsz/ACL4SSR/master/Clash/config/V2rayPro.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (519, 'system-user-001', 'V2Pro', 'https://raw.githubusercontent.com/Mazeorz/airports/master/Clash/V2Pro.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (520, 'system-user-001', '史迪仔-自动测速', 'https://raw.githubusercontent.com/Mazeorz/airports/master/Clash/Stitch.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (521, 'system-user-001', '史迪仔-负载均衡', 'https://raw.githubusercontent.com/Mazeorz/airports/master/Clash/Stitch-Balance.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (522, 'system-user-001', 'Maying', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/customized/maying.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (523, 'system-user-001', 'Ytoo', 'https://subweb.s3.fr-par.scw.cloud/RemoteConfig/customized/ytoo.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (524, 'system-user-001', 'w8ves', 'https://raw.nameless13.com/api/public/dl/M-We_Fn7/w8ves.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (525, 'system-user-001', 'NyanCAT', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/customized/nyancat.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (526, 'system-user-001', 'Nexitally', 'https://subweb.s3.fr-par.scw.cloud/RemoteConfig/customized/nexitally.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (527, 'system-user-001', 'SoCloud', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/customized/socloud.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (528, 'system-user-001', 'ARK', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/customized/ark.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (529, 'system-user-001', 'N3RO', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/n3ro_optimized.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (530, 'system-user-001', 'Scholar', 'https://gist.githubusercontent.com/tindy2013/1fa08640a9088ac8652dbd40c5d2715b/raw/scholar_optimized.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (531, 'system-user-001', 'Flowercloud', 'https://subweb.s3.fr-par.scw.cloud/RemoteConfig/customized/flower.ini', 'config');

-- Group: 特殊
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (601, 'system-user-001', 'NeteaseUnblock', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/special/netease.ini', 'config');
INSERT OR IGNORE INTO subconverter_assets (id, user_id, name, url, type) VALUES (602, 'system-user-001', 'Basic', 'https://raw.githubusercontent.com/SleepyHeeead/subconverter-config/master/remote-config/special/basic.ini', 'config');