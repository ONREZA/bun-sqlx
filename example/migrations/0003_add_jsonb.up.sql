ALTER TABLE users
  ADD COLUMN settings jsonb NOT NULL DEFAULT '{"theme":"light","lang":"en"}'::jsonb;

ALTER TABLE posts
  ADD COLUMN meta jsonb,
  ADD COLUMN attachments jsonb[] NOT NULL DEFAULT '{}';
