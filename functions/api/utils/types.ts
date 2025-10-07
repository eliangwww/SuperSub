// Define Env bindings from wrangler.toml
export type Env = {
  DB: D1Database;
  JWT_SECRET: string;
  SUBS_KV: KVNamespace;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    jwtPayload: {
      id: string;
      username: string;
      role: string;
    };
  };
};