declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    ARENA?: DurableObjectNamespace;
    BUCKET?: R2Bucket;
  }
}

