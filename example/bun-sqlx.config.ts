import type { BunSqlxConfig } from "bun-sqlx";

const config: BunSqlxConfig = {
  jsonbTypes: {
    "users.settings": "BunSqlxJson.UserSettings",
    "posts.meta": "BunSqlxJson.PostMeta",
    "posts.attachments": "BunSqlxJson.Attachment",
  },
};

export default config;
