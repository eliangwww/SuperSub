// Define Env bindings from wrangler.toml
export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
}