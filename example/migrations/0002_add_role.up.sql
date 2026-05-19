CREATE TYPE user_role AS ENUM ('admin', 'editor', 'viewer');

ALTER TABLE users
  ADD COLUMN role user_role NOT NULL DEFAULT 'viewer';

CREATE TYPE post_status AS ENUM ('draft', 'published', 'archived');

ALTER TABLE posts
  ADD COLUMN status post_status NOT NULL DEFAULT 'draft',
  ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN history user_role[] NOT NULL DEFAULT '{}';
