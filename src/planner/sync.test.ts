import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer } from "../../worker/src/fake";
import { content, merge, type PlanContent } from "./merge";
import { emptyPlan, needsExport, newBooking, newDay, newPlace, type Plan } from "./plan";
import { Gone, join, readJoin, settle, share, shareLink, sync, unshare, viewLink, viewOnly } from "./sync";

const base = (): PlanContent => {
    const p = emptyPlan(1000);
    return {
        ...content(p),
        id: "0b7c6f0e-4a8e-4f61-9d39-1d3f4f2c9a10",
        title: "japan",
        start: "2026-12-20",
        days: [
            { key: "d1", places: [newPlace({ key: "tokyo", place: "Tokyo", lat: 35.68, lng: 139.76 }), newPlace({ key: "shibuya", place: "Shibuya Sky" })] },
            { key: "d2", places: [newPlace({ key: "kyoto", place: "Kyoto" })] },
        ],
        ideas: [newPlace({ key: "nara", place: "Nara" })],
    };
};
const keys = (p: PlanContent) => [p.ideas.map((x) => x.key), ...p.days.map((d) => d.places.map((x) => x.key))];
const find = (p: PlanContent, key: string) => [...p.ideas, ...p.days.flatMap((d) => d.places)].find((x) => x.key === key);
/** `p` with the place `key` changed. */
const editPlace = (p: PlanContent, key: string, patch: object): PlanContent => ({
    ...p,
    ideas: p.ideas.map((x) => (x.key === key ? { ...x, ...patch } : x)),
    days: p.days.map((d) => ({ ...d, places: d.places.map((x) => (x.key === key ? { ...x, ...patch } : x)) })),
});

describe("merging shared plans", () => {
    it("keeps both sides' changes to different things", () => {
        const b = base();
        const mine = { ...editPlace(b, "tokyo", { note: "teamLab" }), title: "japan 2026" };
        const theirs = editPlace(b, "kyoto", { note: "Fushimi Inari", lat: 34.97, lng: 135.77 });
        const m = merge(b, mine, theirs);
        expect(m.title).toBe("japan 2026");
        expect(find(m, "tokyo")?.note).toBe("teamLab");
        expect(find(m, "kyoto")).toMatchObject({ note: "Fushimi Inari", lat: 34.97, lng: 135.77 });
        expect(merge(b, b, b)).toEqual(b);
    });

    it("keeps this phone's change when both changed the same thing", () => {
        const b = base();
        const m = merge(b, editPlace(b, "tokyo", { note: "mine" }), editPlace(b, "tokyo", { note: "theirs", name: "Tokyo!" }));
        expect(find(m, "tokyo")).toMatchObject({ note: "mine", name: "Tokyo!" });
    });

    it("keeps places added on both sides, and drops ones removed on either", () => {
        const b = base();
        const mine = { ...b, days: [{ ...b.days[0], places: [...b.days[0].places, newPlace({ key: "ginza", place: "Ginza" })] }, b.days[1]] };
        const theirs = { ...b, ideas: [], days: [b.days[0], { ...b.days[1], places: [...b.days[1].places, newPlace({ key: "osaka", place: "Osaka" })] }] };
        expect(keys(merge(b, mine, theirs))).toEqual([[], ["tokyo", "shibuya", "ginza"], ["kyoto", "osaka"]]);
        // A place removed on one side goes, even if the other side edited it.
        expect(keys(merge(b, editPlace(b, "nara", { note: "deer" }), theirs))[0]).toEqual([]);
    });

    it("moves and reorders places, and adds days from both sides", () => {
        const b = base();
        // Mine: Shibuya before Tokyo. Theirs: Nara onto day 2, and a third day.
        const mine = { ...b, days: [{ ...b.days[0], places: [b.days[0].places[1], b.days[0].places[0]] }, b.days[1]] };
        const theirs: PlanContent = { ...b, ideas: [], days: [b.days[0], { ...b.days[1], places: [...b.days[1].places, b.ideas[0]] }, newDay()] };
        const m = merge(b, mine, theirs);
        expect(keys(m)).toEqual([[], ["shibuya", "tokyo"], ["kyoto", "nara"], []]);
        expect(m.days).toHaveLength(3);
    });

    it("sends the places on a day the other side removed to the ideas", () => {
        const b = base();
        const mine = { ...b, days: [b.days[0], { ...b.days[1], places: [...b.days[1].places, newPlace({ key: "osaka", place: "Osaka" })] }] };
        const theirs = { ...b, days: [b.days[0]], ideas: [...b.ideas, ...b.days[1].places] };
        expect(keys(merge(b, mine, theirs))).toEqual([["nara", "kyoto", "osaka"], ["tokyo", "shibuya"]]);
    });
});

describe("syncing shared plans", () => {
    beforeEach(() => {
        const server = fakeServer();
        vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
            server(new Request(`https://sync.example.com${url}`, { ...init, headers: { ...(init.headers as object), Origin: "https://travel.example.com" } }))
        );
    });
    afterEach(() => vi.unstubAllGlobals());

    const phone = (): Plan => ({ ...base(), exported: 5 });

    it("shares a plan, opens it from the link, and merges two phones' edits", async () => {
        const mine = await share(phone());
        expect(mine.shared?.version).toBe(1);
        expect(mine.exported).toBe(5);
        expect(needsExport(mine)).toBe(false);

        // The link opens the server's preview page, which goes on to the planner's "#join=…".
        const url = shareLink(mine, "");
        expect(mine.shared!.secret).toMatch(/^[A-Za-z0-9_-]{16}$/);
        expect(url).toBe(`/${mine.shared!.secret}`);
        const page = await (await fetch(url, { headers: {} })).text();
        const target = JSON.parse(/location\.replace\(([^)]+)\)/.exec(page)![1]) as string;
        expect(page).toContain('content="japan"');
        const link = readJoin(new URL(target).hash);
        expect(link).toEqual({ secret: mine.shared!.secret });
        const hers = await join(link!, []);
        expect(content(hers)).toEqual(content(mine));
        expect(hers.exported).toBeUndefined();

        // Both edit before either syncs.
        const a = await sync({ ...mine, ...editPlace(content(mine), "tokyo", { note: "teamLab" }), updated: 2000 });
        expect(a.shared?.version).toBe(2);
        const b = await sync({ ...hers, ...editPlace(content(hers), "kyoto", { note: "Fushimi Inari" }), updated: 3000 });
        expect(b.shared?.version).toBe(3);
        expect(find(b, "tokyo")?.note).toBe("teamLab");
        expect(find(b, "kyoto")?.note).toBe("Fushimi Inari");

        // The first phone picks up her edit without sending anything.
        const a2 = await sync(a);
        expect(a2.shared?.version).toBe(3);
        expect(content(a2)).toEqual(content(b));
        // Nothing changed anywhere: same version.
        expect((await sync(a2)).shared?.version).toBe(3);
    });

    it("keeps an edit made while a sync was going", async () => {
        const sent = await share(phone());
        const theirs = await sync({ ...(await join({ secret: sent.shared!.secret }, [])), title: "japan 2026" });
        const result = await sync(sent);
        expect(result.title).toBe("japan 2026");
        const now = { ...sent, ...editPlace(content(sent), "tokyo", { note: "typed meanwhile" }) };
        const settled = settle(sent, now, result);
        expect(settled.title).toBe("japan 2026");
        expect(find(settled, "tokyo")?.note).toBe("typed meanwhile");
        expect(settled.shared?.version).toBe(theirs.shared?.version);
        expect(settle(sent, sent, result)).toEqual({ ...result, exported: 5 });
    });

    it("deletes a shared plan for everyone", async () => {
        const mine = await share(phone());
        const hers = await join({ secret: mine.shared!.secret }, []);
        await unshare(mine);
        await expect(sync(hers)).rejects.toBeInstanceOf(Gone);
        await expect(sync({ ...hers, title: "edited meanwhile" })).rejects.toBeInstanceOf(Gone);
        await expect(join({ secret: mine.shared!.secret }, [])).rejects.toBeInstanceOf(Gone);
        // Deleting it again is fine.
        await unshare(mine);
    });

    it("says when a link is wrong", async () => {
        const p = await share(phone());
        await expect(join({ secret: "b".repeat(16) }, [])).rejects.toThrow("isn't on the server");
        expect(readJoin("#join=nonsense")).toBeUndefined();
        // Links from before codes still read.
        const old = `${p.id}.${"c".repeat(64)}`;
        expect(readJoin(`#join=${old}`)).toEqual({ id: p.id, secret: "c".repeat(64) });
    });

    it("gives a view-only link that sees the plan and its changes but can't change it", async () => {
        const mine = await share(phone());
        const { plan: withView, link } = await viewLink(mine, "");
        expect(withView.shared!.view).toMatch(/^[A-Za-z0-9_-]{20}$/);
        // The same link every time, from any phone with the edit link.
        expect((await viewLink(withView, "")).link).toBe(link);
        expect((await viewLink(await join({ secret: mine.shared!.secret }, []), "")).link).toBe(link);

        const page = await (await fetch(link, { headers: {} })).text();
        expect(page).toContain('content="japan"');
        const target = readJoin(new URL(JSON.parse(/location\.replace\(([^)]+)\)/.exec(page)![1]) as string).hash)!;
        const theirs = await join(target, []);
        expect(viewOnly(theirs)).toBe(true);
        expect(content(theirs)).toEqual(content(mine));
        expect(shareLink(theirs, "")).toBe(link);
        expect((await viewLink(theirs, "")).link).toBe(link);

        // It follows the edits, never sends its own, and the server turns away any that slip through.
        const edited = await sync({ ...withView, title: "japan 2026" });
        const seen = await sync({ ...theirs, title: "mine now" });
        expect(seen.title).toBe("japan 2026");
        expect(seen.shared!.version).toBe(edited.shared!.version);
        const put = await fetch("/shared", {
            method: "PUT",
            headers: { Authorization: `Bearer ${theirs.shared!.secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ version: seen.shared!.version, plan: { ...content(seen), title: "hacked" } }),
        });
        expect(put.status).toBe(403);
        expect((await fetch("/shared", { method: "DELETE", headers: { Authorization: `Bearer ${theirs.shared!.secret}` } })).status).toBe(403);
        expect((await fetch("/shared/picture", { method: "PUT", headers: { Authorization: `Bearer ${theirs.shared!.secret}`, "Content-Type": "image/jpeg" }, body: new Uint8Array([1]) })).status).toBe(403);
        expect((await sync(edited)).title).toBe("japan 2026");

        // Opening the view-only link on a phone with the edit link keeps the edit link; the edit link upgrades a view-only phone.
        expect(viewOnly(await join(target, [edited]))).toBe(false);
        expect(viewOnly(await join({ secret: mine.shared!.secret }, [seen]))).toBe(false);

        // Deleted for everyone: the view-only link stops too.
        await unshare(edited);
        await expect(sync(seen)).rejects.toBeInstanceOf(Gone);
    });

    it("still syncs plans shared before codes", async () => {
        const secret = "d".repeat(64);
        const res = await fetch(`/plans/${base().id}`, {
            method: "PUT",
            headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
            body: JSON.stringify({ version: 0, plan: base() }),
        });
        expect(res.status).toBe(200);
        const p = await join({ id: base().id, secret }, []);
        expect(shareLink(p, "")).toBe(`/p/${p.id}.${secret}`);
        const edited = await sync({ ...p, title: "japan!" });
        expect(edited.shared?.version).toBe(2);
        await expect(join({ id: base().id, secret: "e".repeat(64) }, [])).rejects.toThrow("doesn't open");
        // They get view-only links too.
        const { link } = await viewLink(p, "");
        const seen = await join({ secret: link.slice(1) }, []);
        expect(viewOnly(seen) && seen.title).toBe("japan!");
    });
});

describe("merging flights and hotels", () => {
    it("keeps both sides' changes, and leaves plans without bookings alone", () => {
        const base = content({ ...emptyPlan(1), bookings: [newBooking("hotel", { key: "h", name: "Kanra" })] });
        const mine = { ...base, bookings: [{ ...base.bookings![0], note: "booking 123" }] };
        const theirs = { ...base, bookings: [{ ...base.bookings![0], start: "2027-04-03", end: "2027-04-05" }, newBooking("flight", { key: "f", name: "JL 44" })] };
        const m = merge(base, mine, theirs);
        expect(m.bookings!.map((b) => [b.key, b.note, b.start])).toEqual([["h", "booking 123", "2027-04-03"], ["f", "", ""]]);
        expect(merge(base, { ...base, bookings: [] }, theirs).bookings!.map((b) => b.key)).toEqual(["f"]);
        const old = content(emptyPlan(1));
        expect("bookings" in merge(old, old, old)).toBe(false);
    });
});
