CREATE TABLE IF NOT EXISTS users (
  id CHAR(36) PRIMARY KEY,
  google_sub VARCHAR(255) NOT NULL UNIQUE,
  email VARCHAR(254) NOT NULL,
  name VARCHAR(255) NOT NULL,
  avatar TEXT,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS senders (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(254) NOT NULL,
  smtp_host VARCHAR(255) NOT NULL DEFAULT 'smtp.ethereal.email',
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_secret TEXT NOT NULL,
  hourly_limit INT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_senders_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS campaigns (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  subject VARCHAR(300) NOT NULL,
  body MEDIUMTEXT NOT NULL,
  start_at DATETIME(3) NOT NULL,
  delay_ms INT NOT NULL,
  hourly_limit INT NOT NULL,
  recipient_count INT NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY idx_campaign_idempotency (user_id, idempotency_key),
  INDEX idx_campaign_user (user_id, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (sender_id) REFERENCES senders(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emails (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  campaign_id CHAR(36) NOT NULL,
  sender_id CHAR(36) NOT NULL,
  recipient VARCHAR(254) NOT NULL,
  sequence_number INT NOT NULL,
  status ENUM('scheduled','deferred','sending','sent','failed','delivery_unknown','cancelled') NOT NULL DEFAULT 'scheduled',
  scheduled_at DATETIME(3) NOT NULL,
  original_scheduled_at DATETIME(3) NOT NULL,
  send_started_at DATETIME(3),
  sent_at DATETIME(3),
  message_id VARCHAR(255),
  preview_url TEXT,
  error_message VARCHAR(1000),
  attempts INT NOT NULL DEFAULT 0,
  generation INT NOT NULL DEFAULT 0,
  revision INT NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY idx_campaign_recipient (campaign_id, recipient),
  INDEX idx_user_status_time (user_id, status, scheduled_at, id),
  INDEX idx_user_sent (user_id, status, sent_at, id),
  INDEX idx_sending_recovery (status, send_started_at),
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  FOREIGN KEY (sender_id) REFERENCES senders(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS slack_connections (
  user_id CHAR(36) PRIMARY KEY,
  team_id VARCHAR(100) NOT NULL,
  team_name VARCHAR(255) NOT NULL,
  channel_name VARCHAR(255) NOT NULL,
  webhook_secret TEXT NOT NULL,
  bot_secret TEXT NOT NULL,
  connected_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS outbox (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('enqueue','index','slack') NOT NULL,
  user_id CHAR(36) NOT NULL,
  email_id CHAR(36),
  payload JSON NOT NULL,
  dedupe_key VARCHAR(255) UNIQUE,
  attempts INT NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  delivered_at DATETIME(3),
  last_error VARCHAR(1000),
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_outbox_pending (delivered_at, available_at, id),
  INDEX idx_outbox_user (user_id, kind, created_at)
) ENGINE=InnoDB;
