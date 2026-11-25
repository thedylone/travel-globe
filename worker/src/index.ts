// The trip planner's sync server, a Cloudflare Worker. It keeps each shared plan in its own
// Durable Object, which handles one request at a time, so two phones saving at once can't
// overwrite each other: a save says which version it was based on, and is turned away (with the
// newest version, to merge with) if someone else saved first.
//
// There are no accounts. Sharing a plan makes a random secret, which goes in the share link;
// the server keeps only a hash of it, and anyone with the link can read and change that plan.
//
// GET /plans/<id>                               -> { version, plan }
// PUT /plans/<id>  { version, plan }            -> { version, plan }, or 409 with the newest
//                                                  (version 0 makes the plan, the first time)

/** The bits of the Durable Object storage this uses. */
export interface RoomStorage {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
}

export interface RoomState {
    storage: RoomStorage;
}

/** The bits of the Durable Object binding this uses. */
export interface RoomNamespace {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
}

export interface Env {
    PLANS: RoomNamespace;
    /** Comma-separated origins allowed to call this from a browser. */
    ALLOWED_ORIGINS: string;
}

/** A plan is a few KB; this leaves room for a long trip with long notes. */
export const MAX_BODY_BYTES = 512 * 1024;
const TOKEN = /^Bearer ([0-9a-f]{64})$/;
const PLAN_PATH = /^\/plans\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

interface Room {
    /** SHA-256 of the secret, in hex. */
    secret: string;
    version: number;
    plan: unknown;
    updatedAt: number;
}

const allowedOrigin = (request: Request, env: Env): string | null | false => {
    const origin = request.headers.get("Origin");
    if (!origin) return null; // not a browser, e.g. curl
    const allowed = (env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((o) => o.trim().replace(/\/+$/, ""))
        .filter(Boolean);
    return allowed.includes(origin) ? origin : false;
};

const corsHeaders = (origin: string | null): Record<string, string> =>
    origin
        ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
              "Access-Control-Allow-Headers": "Authorization, Content-Type",
              "Access-Control-Max-Age": "86400",
              Vary: "Origin",
          }
        : {};

const json = (body: unknown, status: number, origin: string | null = null) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders(origin) },
    });

const sha256 = async (text: string) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

/** Enough of a plan to be sure it's one: the planner checks the rest as it reads it. */
const looksLikePlan = (p: unknown, id: string) => {
    if (!p || typeof p !== "object") return false;
    const x = p as Record<string, unknown>;
    return x.id === id && Array.isArray(x.days) && Array.isArray(x.ideas) && typeof x.title === "string";
};

/** The Worker: checks where a request is from and what it's for, and passes it to the plan's room. */
export const handle = async (request: Request, env: Env): Promise<Response> => {
    const origin = allowedOrigin(request, env);
    if (origin === false) return json({ error: "origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const match = PLAN_PATH.exec(new URL(request.url).pathname);
    if (!match) return json({ error: "not found" }, 404, origin);
    if (request.method !== "GET" && request.method !== "PUT") return json({ error: "method not allowed" }, 405, origin);
    if (!TOKEN.test(request.headers.get("Authorization") ?? "")) return json({ error: "missing or bad token" }, 401, origin);
    if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) return json({ error: "too big" }, 413, origin);

    const room = env.PLANS.get(env.PLANS.idFromName(match[1]));
    const res = await room.fetch(request);
    return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...corsHeaders(origin) } });
};

/** One shared plan. Durable Objects run one request at a time between storage calls. */
export class PlanRoom {
    constructor(
        private state: RoomState,
        _env?: unknown
    ) {}

    async fetch(request: Request): Promise<Response> {
        const id = PLAN_PATH.exec(new URL(request.url).pathname)?.[1];
        const token = TOKEN.exec(request.headers.get("Authorization") ?? "")?.[1];
        if (!id || !token) return json({ error: "bad request" }, 400);
        const secret = await sha256(token);

        let body: { version?: unknown; plan?: unknown } | undefined;
        if (request.method === "PUT") {
            const text = await request.text();
            if (text.length > MAX_BODY_BYTES) return json({ error: "too big" }, 413);
            try {
                body = JSON.parse(text);
            } catch {
                body = undefined;
            }
            if (!body || !Number.isInteger(body.version) || !looksLikePlan(body.plan, id)) return json({ error: "bad plan" }, 400);
        }

        // From here to the put there's nothing but storage, so no other request can come between.
        const saved = await this.state.storage.get<Room>("room");
        if (saved && saved.secret !== secret) return json({ error: "wrong link" }, 403);
        if (!body) return saved ? json({ version: saved.version, plan: saved.plan }, 200) : json({ error: "no such plan" }, 404);

        const current = saved?.version ?? 0;
        if (body.version !== current) {
            return saved ? json({ version: saved.version, plan: saved.plan }, 409) : json({ error: "no such plan" }, 404);
        }
        const room: Room = { secret, version: current + 1, plan: body.plan, updatedAt: Date.now() };
        await this.state.storage.put("room", room);
        return json({ version: room.version, plan: room.plan }, 200);
    }
}

export default {
    fetch: (request: Request, env: Env) => handle(request, env).catch(() => json({ error: "something broke" }, 500)),
};
