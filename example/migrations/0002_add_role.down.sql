ALTER TABLE posts DROP COLUMN history, DROP COLUMN tags, DROP COLUMN status;
ALTER TABLE users DROP COLUMN role;
DROP TYPE post_status;
DROP TYPE user_role;
