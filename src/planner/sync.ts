// Shared plans: a plan with a share link is kept in sync with everyone who has the link, through
// the sync server in worker/ (its address is "sync" in site.yaml). The plan in this browser stays
// the one the planner shows and edits, so everything works offline; syncing merges in what the
// others changed and sends what this phone changed.
import { content, merge, type PlanContent, sameContent } from "./merge";
import type { Plan } from "./plan";

/** The sync server's address, from site.yaml; sharing is hidden without one. */
export const SYNC_URL = __PLANNER_SYNC__.replace(/\/+$/, "");

/** A share code: 16 characters of base64url (96 random bits). It's the share link and the key to the plan. */
export const newCode = () =>
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(12))))
        .replace(/\+/g, "-")
        .replace(/\//g, "_");

/** A view-only code is 20 characters: it can read the plan but not change it. */
export const isViewCode = (secret: string) => /^[A-Za-z0-9_-]{20}$/.test(secret);

/** Opened from a view-only link, so this phone can look but not change it. */
export const viewOnly = (p: Plan) => !!p.shared && isViewCode(p.shared.secret);

/** Plans shared before codes have a 64-character secret, used with their id. */
const isOldSecret = (secret: string) => /^[0-9a-f]{64}$/.test(secret);

/**
 * The link that opens a shared plan on another phone. It goes through the sync server, which
 * gives chat apps a preview with the plan's name, dates and picture, then on to the planner's
 * "#join=…".
 */
export const shareLink = (p: Plan, server = SYNC_URL) =>
    !p.shared ? "" : isOldSecret(p.shared.secret) ? `${server}/p/${p.id}.${p.shared.secret}` : `${server}/${p.shared.secret}`;

/** The code (or, from older links, the plan and secret) in a share link's "#join=…", if it has one. */
export const readJoin = (hash: string): { id?: string; secret: string } | undefined => {
    const join = new URLSearchParams(hash.replace(/^#/, "")).get("join") ?? "";
    const old = /^([0-9a-f-]{36})\.([0-9a-f]{64})$/.exec(join);
    if (old) return { id: old[1], secret: old[2] };
    return /^(?:[A-Za-z0-9_-]{16}|[A-Za-z0-9_-]{20})$/.test(join) ? { secret: join } : undefined;
};

interface Saved {
    version: number;
    plan: PlanContent;
}

/** The plan isn't on the server: someone deleted it for everyone (or it never got there). */
export class Gone extends Error {
    constructor() {
        super("this shared plan isn't on the server any more");
    }
}

class Conflict extends Error {
    constructor(readonly saved: Saved) {
        super("someone else saved first");
    }
}

/** The plan's address on the server: by its code, or by its id for plans shared before codes. */
const address = (id: string | undefined, secret: string) => (isOldSecret(secret) ? `${SYNC_URL}/plans/${id}` : `${SYNC_URL}/shared`);

const check = async (res: Response) => {
    if (res.status === 409) throw new Conflict(await res.json());
    if (res.status === 404) throw new Gone();
    if (res.status === 403) throw new Error((await res.json().catch(() => ({}))).error === "view only" ? "this is a view-only link" : "this link doesn't open that plan");
    if (!res.ok) throw new Error(`the sync server said ${res.status}`);
    return res.json();
};

const request = async (id: string | undefined, secret: string, body?: { version: number; plan: PlanContent }): Promise<Saved> =>
    check(
        await fetch(address(id, secret), {
            method: body ? "PUT" : "GET",
            headers: { Authorization: `Bearer ${secret}`, ...(body ? { "Content-Type": "application/json" } : {}) },
            body: body && JSON.stringify(body),
            cache: "no-store",
        })
    );

/** Deletes a shared plan from the server, for everyone with its link. */
export const unshare = async (p: Plan): Promise<void> => {
    if (!p.shared) return;
    const res = await fetch(address(p.id, p.shared.secret), { method: "DELETE", headers: { Authorization: `Bearer ${p.shared.secret}` } });
    if (res.status !== 404) await check(res);
};

/** Sends the trip's link-preview picture (see picture.ts). */
export const sendPicture = async (p: Plan, picture: Blob): Promise<void> => {
    if (!p.shared) return;
    await check(
        await fetch(`${address(p.id, p.shared.secret)}/picture`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${p.shared.secret}`, "Content-Type": picture.type },
            body: picture,
        })
    );
};

/**
 * The link that shows a shared plan without letting anyone change it. The server makes it the
 * first time anyone asks, and gives the same one after; this phone keeps it in `shared.view`.
 */
export const viewLink = async (p: Plan, server = SYNC_URL): Promise<{ plan: Plan; link: string }> => {
    if (!p.shared) throw new Error("the plan isn't shared");
    if (viewOnly(p)) return { plan: p, link: shareLink(p, server) };
    let view = p.shared.view;
    if (!view) {
        const res = await fetch(`${address(p.id, p.shared.secret)}/view`, { method: "POST", headers: { Authorization: `Bearer ${p.shared.secret}` } });
        view = ((await check(res)) as { view: string }).view;
        p = { ...p, shared: { ...p.shared, view } };
    }
    return { plan: p, link: `${server}/${view}` };
};

/** The plan as the server has it, as a plan on this phone, with `local`'s own bits kept. */
const fromServer = (s: Saved, secret: string, local?: Plan, now = Date.now()): Plan => ({
    ...s.plan,
    exported: local?.exported,
    shared: { secret, version: s.version, base: s.plan, synced: now, picture: local?.shared?.picture, ...(local?.shared?.view ? { view: local.shared.view } : {}) },
});

/** Puts a plan on the server for the first time, with a new code. */
export const share = async (p: Plan): Promise<Plan> => {
    const secret = newCode();
    return fromServer(await request(p.id, secret, { version: 0, plan: content(p) }), secret, p);
};

/** Fetches a plan from its share link; `plans` are the ones on this phone, which may have it already. */
export const join = async (link: { id?: string; secret: string }, plans: Plan[]): Promise<Plan> => {
    const { secret } = link;
    const saved = await request(link.id, secret);
    const local = plans.find((p) => p.id === saved.plan.id);
    if (!local?.shared) return fromServer(saved, secret, local);
    // Already on this phone: keep what it changed since it last synced. A view-only link doesn't
    // take away the edit link this phone has; an edit link replaces a view-only one.
    const keepEdit = isViewCode(secret) && !viewOnly(local);
    return sync({ ...local, shared: { ...local.shared, secret: keepEdit ? local.shared.secret : secret } });
};

/**
 * Brings a shared plan up to date: sends this phone's changes, or fetches the others' if it has
 * none. When someone else saved first, their version is merged with this phone's and sent again.
 */
export const sync = async (p: Plan): Promise<Plan> => {
    const shared = p.shared;
    if (!shared) return p;
    const mine = content(p);
    // A view-only phone only ever fetches: there's nothing of its own to send.
    if (viewOnly(p)) {
        const saved = await request(p.id, shared.secret);
        return saved.version === shared.version && sameContent(mine, shared.base) ? { ...p, shared: { ...shared, synced: Date.now() } } : fromServer(saved, shared.secret, p);
    }
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
