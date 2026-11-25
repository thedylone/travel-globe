// Shared plans: a plan with a share link is kept in sync with everyone who has the link, through
// the sync server in worker/ (its address is "sync" in site.yaml). The plan in this browser stays
// the one the planner shows and edits, so everything works offline; syncing merges in what the
// others changed and sends what this phone changed.
import { content, merge, type PlanContent, sameContent } from "./merge";
import type { Plan } from "./plan";

/** The sync server's address, from site.yaml; sharing is hidden without one. */
export const SYNC_URL = __PLANNER_SYNC__.replace(/\/+$/, "");

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
export const newSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));

/**
 * The link that opens a shared plan on another phone. It goes through the sync server, which
 * gives chat apps a preview with the plan's name and dates, then on to the planner's
 * "#join=<id>.<secret>" (which still works on its own, for links shared before).
 */
export const shareLink = (p: Plan, server = SYNC_URL) => (p.shared ? `${server}/p/${p.id}.${p.shared.secret}` : "");

/** The plan and secret in a share link's "#join=…", if it has one. */
export const readJoin = (hash: string) => {
    const m = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(new URLSearchParams(hash.replace(/^#/, "")).get("join") ?? "");
    return m ? { id: m[1], secret: m[2] } : undefined;
};

interface Saved {
    version: number;
    plan: PlanContent;
}

class Conflict extends Error {
    constructor(readonly saved: Saved) {
        super("someone else saved first");
    }
}

const request = async (id: string, secret: string, body?: { version: number; plan: PlanContent }): Promise<Saved> => {
    const res = await fetch(`${SYNC_URL}/plans/${id}`, {
        method: body ? "PUT" : "GET",
        headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body && JSON.stringify(body),
        cache: "no-store",
    });
    if (res.status === 409) throw new Conflict(await res.json());
    if (res.status === 404) throw new Error("this shared plan isn't on the server any more");
    if (res.status === 403) throw new Error("this link doesn't open that plan");
    if (!res.ok) throw new Error(`the sync server said ${res.status}`);
    return res.json();
};

/** The plan as the server has it, as a plan on this phone, with `local`'s own bits kept. */
const fromServer = (s: Saved, secret: string, local?: Plan, now = Date.now()): Plan => ({
    ...s.plan,
    exported: local?.exported,
    shared: { secret, version: s.version, base: s.plan, synced: now },
});

/** Puts a plan on the server for the first time, with a new secret. */
export const share = async (p: Plan): Promise<Plan> => {
    const secret = newSecret();
    return fromServer(await request(p.id, secret, { version: 0, plan: content(p) }), secret, p);
};

/** Fetches a plan from its share link. */
export const join = async (id: string, secret: string, local?: Plan): Promise<Plan> => {
    const saved = await request(id, secret);
    if (!local?.shared) return fromServer(saved, secret, local);
    // Already on this phone: keep what it changed since it last synced.
    return sync({ ...local, shared: { ...local.shared, secret } });
};

/**
 * Brings a shared plan up to date: sends this phone's changes, or fetches the others' if it has
 * none. When someone else saved first, their version is merged with this phone's and sent again.
 */
export const sync = async (p: Plan): Promise<Plan> => {
    const shared = p.shared;
    if (!shared) return p;
    const mine = content(p);
    if (sameContent(mine, shared.base)) {
        const saved = await request(p.id, shared.secret);
        return saved.version === shared.version ? { ...p, shared: { ...shared, synced: Date.now() } } : fromServer(saved, shared.secret, p);
    }
    let theirs: Saved = { version: shared.version, plan: shared.base };
    let next = mine;
    for (let tries = 0; tries < 4; tries++) {
        try {
            return fromServer(await request(p.id, shared.secret, { version: theirs.version, plan: next }), shared.secret, p);
        } catch (e) {
            if (!(e instanceof Conflict)) throw e;
            theirs = e.saved;
            next = merge(shared.base, mine, theirs.plan);
        }
    }
    throw new Error("the plan kept changing while it synced; it'll try again");
};

/**
 * A sync's result, given that `sent` was what was synced and `now` is the plan on this phone
 * now: unchanged since, it's the result; changed since (an edit while it synced), the edit is
 * merged in, to be sent next time.
 */
export const settle = (sent: Plan, now: Plan, result: Plan): Plan => {
    if (now === sent || sameContent(content(now), content(sent))) return { ...result, exported: now.exported };
    return { ...merge(content(sent), content(now), content(result)), exported: now.exported, shared: result.shared };
};
