// Define Env bindings from wrangler.toml
export type Env = {
  DB: D1Database;
  KV: KVNamespace;
  JWT_SECRET: string;
}