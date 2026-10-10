import { env } from "cloudflare:workers";
import type { Database } from "./engine";
export function database():Database {if(!env.DB)throw new Error("DATABASE_UNAVAILABLE");return env.DB as unknown as Database;}
