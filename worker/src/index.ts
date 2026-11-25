// The trip planner's sync server, a Cloudflare Worker. It keeps each shared plan in its own
// Durable Object, which handles one request at a time, so two phones saving at once can't
// overwrite each other: a save says which version it was based on, and is turned away (with the
// newest version, to merge with) if someone else saved first.
//
// There are no accounts. Sharing a plan makes a random code, which is the share link; the server
// keeps only a hash of it, and anyone with the link can read and change that plan. (Plans shared
// before codes have a plan id and a longer secret instead; they work the same way.)
//
// GET /shared                 Bearer <code>     -> { version, plan, picture }
// PUT /shared                 { version, plan } -> { version, plan, picture }, or 409 with the newest
//                                                  (version 0 makes the plan, the first time)
// PUT /shared/picture         a JPEG or PNG     -> { picture }: the trip's link-preview picture
// GET|PUT /plans/<id>[/picture]  Bearer <secret>: the same, for plans shared before codes
// GET /<code>  (or /p/<code>, /p/<id>.<secret>) -> the share link: a page with link-preview tags
//                                                  that goes on to the planner (see preview.ts)
// GET /<code>/picture                           -> the trip's picture, for that page
import { previewPage } from "./preview";

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
    /** The planner's address, which share links go on to. Its preview.png is the links' picture until a trip has its own. */
    PLANNER_URL?: string;
}

/** A plan is a few KB; this leaves room for a long trip with long notes. */
export const MAX_BODY_BYTES = 512 * 1024;
/** A 1200×630 JPEG is about 100 KB. */
export const MAX_PICTURE_BYTES = 600 * 1024;
const PICTURE_TYPES = ["image/jpeg", "image/png"];

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const IS_UUID = new RegExp(`^${UUID}$`);
/** A share code: 16 characters of base64url, 96 random bits. */
export const CODE = "[A-Za-z0-9_-]{16}";
const SECRET = "[0-9a-f]{64}";
const TOKEN = new RegExp(`^Bearer (${CODE}|${SECRET})$`);
const OLD_API = new RegExp(`^/plans/(${UUID})(/picture)?$`);
const API = /^\/shared(\/picture)?$/;
/** A share link: /<code>, or (from before codes were the whole link) /p/<code> or /p/<id>.<secret>. */
const LINK = new RegExp(`^/(?:p/)?(${CODE}|(${UUID})\\.(${SECRET}))(/picture)?$`);

interface Room {
    /** SHA-256 of the code (or secret), in hex. */
    secret: string;
    version: number;
    plan: { id: string } & Record<string, unknown>;
    updatedAt: number;
    /** Counts the trip's pictures, so a new one gets a new address (chat apps keep pictures a while). */
    picture?: number;
    pictureType?: string;
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
const looksLikePlan = (p: unknown, id: string | undefined) => {
    if (!p || typeof p !== "object") return false;
    const x = p as Record<string, unknown>;
    return typeof x.id === "string" && IS_UUID.test(x.id) && (!id || x.id === id) && Array.isArray(x.days) && Array.isArray(x.ideas) && typeof x.title === "string";
};

/**
 * The room a token opens. A code's room is named after its hash, so the code itself is never
 * stored; a plan shared before codes has a room named after its id, and needs its secret.
 */
const roomFor = async (env: Env, token: string, id?: string) => env.PLANS.get(env.PLANS.idFromName(id ?? `code:${await sha256(token)}`));

/** Asks a plan's room to do `op` ("plan" or "picture"), as `request` asked. */
const askRoom = async (env: Env, op: string, token: string, id: string | undefined, request?: Request) => {
    const room = await roomFor(env, token, id);
    const headers = new Headers({ "X-Token": token, ...(id ? { "X-Plan-Id": id } : {}) });
    const type = request?.headers.get("Content-Type");
    if (type) headers.set("Content-Type", type);
    const body = request?.method === "PUT" ? await request.arrayBuffer() : null;
    return room.fetch(new Request(`https://room.internal/${op}`, { method: request?.method ?? "GET", headers, body }));
};

/** The planner's address: PLANNER_URL, or <the first allowed origin>/planner/. */
const plannerUrl = (env: Env) =>
    (env.PLANNER_URL || `${(env.ALLOWED_ORIGINS ?? "").split(",")[0].trim().replace(/\/+$/, "")}/planner/`).replace(/\/*$/, "/");

const PAGE_HEADERS = {
    // It has the plan's name in it: never kept by a shared cache or a search engine.
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
};

/**
 * A share link, opened by a person or by a chat app making its preview. The preview names the plan
 * only when the link opens it; either way the page goes on to the planner, which says if the
 * link is wrong.
 */
const sharePage = async (request: Request, env: Env, link: string, token: string, id: string | undefined, picture: boolean): Promise<Response> => {
    const head = request.method === "HEAD";
    if (picture) {
        const res = await askRoom(env, "picture", token, id);
        if (!res.ok) return new Response(null, { status: 404, headers: PAGE_HEADERS });
        return new Response(head ? null : res.body, { headers: { ...PAGE_HEADERS, "Content-Type": res.headers.get("Content-Type") ?? "image/jpeg" } });
    }
    const res = await askRoom(env, "plan", token, id);
    const saved = res.ok ? ((await res.json()) as { plan?: object; picture?: number }) : undefined;
    const planner = plannerUrl(env);
    const here = new URL(request.url);
    const image = saved?.picture ? `${here.origin}${here.pathname}/picture?v=${saved.picture}` : `${planner}preview.png`;
    const html = previewPage({ plan: saved?.plan, url: `${here.origin}${here.pathname}`, planner: `${planner}#join=${link}`, image });
    return new Response(head ? null : html, {
        headers: {
            ...PAGE_HEADERS,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        },
    });
};

/** The Worker: checks where a request is from and what it's for, and passes it to the plan's room. */
export const handle = async (request: Request, env: Env): Promise<Response> => {
    const path = new URL(request.url).pathname;
    const link = LINK.exec(path);
    if (link && (request.method === "GET" || request.method === "HEAD")) {
        const [, whole, id, secret, picture] = link;
        return sharePage(request, env, whole, secret ?? whole, id, !!picture);
    }

    // The bare address (someone trimming a link): the planner.
    if (path === "/" && request.method === "GET") return Response.redirect(plannerUrl(env), 302);

    const origin = allowedOrigin(request, env);
    if (origin === false) return json({ error: "origin not allowed" }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });

    const old = OLD_API.exec(path);
    const api = API.exec(path);
    if (!old && !api) return json({ error: "not found" }, 404, origin);
    if (request.method !== "GET" && request.method !== "PUT") return json({ error: "method not allowed" }, 405, origin);
    const token = TOKEN.exec(request.headers.get("Authorization") ?? "")?.[1];
    // Old plans have a long secret, new ones a code.
    if (!token || (old ? token.length !== 64 : token.length === 64)) return json({ error: "missing or bad token" }, 401, origin);
    const picture = !!(old ? old[2] : api![1]);
    const limit = picture ? MAX_PICTURE_BYTES : MAX_BODY_BYTES;
    if (Number(request.headers.get("Content-Length") ?? 0) > limit) return json({ error: "too big" }, 413, origin);
    if (picture && request.method !== "PUT") return json({ error: "method not allowed" }, 405, origin);

    const res = await askRoom(env, picture ? "picture" : "plan", token, old?.[1], request);
    return new Response(res.body, { status: res.status, headers: { ...Object.fromEntries(res.headers), ...corsHeaders(origin) } });
};

/** One shared plan. Durable Objects run one request at a time between storage calls. */
export class PlanRoom {
    constructor(
        private state: RoomState,
        _env?: unknown
    ) {}

    async fetch(request: Request): Promise<Response> {
        const op = new URL(request.url).pathname.slice(1);
        const token = request.headers.get("X-Token");
        const id = request.headers.get("X-Plan-Id") ?? undefined;
        if (!token) return json({ error: "bad request" }, 400);
        const secret = await sha256(token);
        return op === "picture" ? this.picture(request, secret) : this.plan(request, secret, id);
    }

    private async plan(request: Request, secret: string, id: string | undefined): Promise<Response> {
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
        const reply = (r: Room, status: number) => json({ version: r.version, plan: r.plan, ...(r.picture ? { picture: r.picture } : {}) }, status);
        if (!body) return saved ? reply(saved, 200) : json({ error: "no such plan" }, 404);

        const current = saved?.version ?? 0;
        if (body.version !== current) return saved ? reply(saved, 409) : json({ error: "no such plan" }, 404);
        const plan = body.plan as Room["plan"];
        // A room keeps the one plan it was made with.
        if (saved && plan.id !== saved.plan.id) return json({ error: "bad plan" }, 400);
        const room: Room = { ...saved, secret, version: current + 1, plan, updatedAt: Date.now() };
        await this.state.storage.put("room", room);
        return reply(room, 200);
    }

    private async picture(request: Request, secret: string): Promise<Response> {
        const saved = await this.state.storage.get<Room>("room");
        if (!saved) return json({ error: "no such plan" }, 404);
        if (saved.secret !== secret) return json({ error: "wrong link" }, 403);
        if (request.method !== "PUT") {
            const bytes = saved.picture ? await this.state.storage.get<ArrayBuffer>("picture") : undefined;
            return bytes ? new Response(bytes, { headers: { "Content-Type": saved.pictureType ?? "image/jpeg" } }) : json({ error: "no picture" }, 404);
        }
        const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim();
        if (!PICTURE_TYPES.includes(type)) return json({ error: "not a JPEG or PNG" }, 415);
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > MAX_PICTURE_BYTES) return json({ error: "too big" }, 413);
        if (!bytes.byteLength) return json({ error: "no picture" }, 400);
        // The picture and its count change together (a Durable Object writes both or neither).
        const latest = (await this.state.storage.get<Room>("room")) ?? saved;
        const room: Room = { ...latest, picture: (latest.picture ?? 0) + 1, pictureType: type };
        await this.state.storage.put("picture", bytes);
        await this.state.storage.put("room", room);
        return json({ picture: room.picture }, 200);
    }
}

export default {
    fetch: (request: Request, env: Env) => handle(request, env).catch(() => json({ error: "something broke" }, 500)),
};
