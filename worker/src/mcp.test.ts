import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeServer } from "./fake";
import { readLink } from "./mcp";
import { emptyPlan, newPlace, type Plan } from "../../src/planner/plan";
import { join, share, sync } from "../../src/planner/sync";

const ORIGIN = "https://sync.example.com";
let server: ReturnType<typeof fakeServer>;
/** Places the fake map search knows. */
const MAP: Record<string, { name: string; city: string; country: string; countrycode: string; at: [number, number] }> = {
    "fushimi inari": { name: "Fushimi Inari Taisha", city: "Kyoto", country: "Japan", countrycode: "JP", at: [135.7727, 34.9671] },
    "kinkaku-ji": { name: "Kinkaku-ji", city: "Kyoto", country: "Japan", countrycode: "JP", at: [135.7292, 35.0394] },
    nara: { name: "Nara", city: "Nara", country: "Japan", countrycode: "JP", at: [135.8048, 34.6851] },
};
let searches: string[] = [];

beforeEach(() => {
    server = fakeServer();
    searches = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
        if (url.startsWith("https://photon.komoot.io/")) {
            const u = new URL(url);
            searches.push(u.search);
            const hit = MAP[(u.searchParams.get("q") ?? "").toLowerCase()];
            const features = hit ? [{ geometry: { coordinates: hit.at }, properties: { name: hit.name, city: hit.city, country: hit.country, countrycode: hit.countrycode } }] : [];
            return new Response(JSON.stringify({ features }));
        }
        // The planner's own requests (SYNC_URL is "" in tests).
        return server(new Request(`${ORIGIN}${url}`, { ...init, headers: { ...(init.headers as object), Origin: "https://travel.example.com" } }));
    });
});
afterEach(() => vi.unstubAllGlobals());

let nextId = 1;
const rpc = async (method: string, params?: object, headers: Record<string, string> = {}) => {
    const res = await server(new Request(`${ORIGIN}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }) }));
    return { status: res.status, body: (await res.json()) as { result?: any; error?: { code: number; message: string } } };
};
/** Calls a tool: its result, or throws its error. */
const call = async (name: string, args: object) => {
    const { body } = await rpc("tools/call", { name, arguments: args });
    const r = body.result;
    if (r.isError) throw new Error(r.content[0].text);
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
    return r.structuredContent;
};

const phonePlan = (): Plan => ({
    ...emptyPlan(1000),
    title: "japan",
    start: "2027-04-03",
    country: "jp",
    days: [
        { key: "d1", places: [newPlace({ key: "kyoto", place: "Kyoto", lat: 35.01, lng: 135.77 })] },
        { key: "d2", places: [] },
    ],
});

describe("the connector for AI agents", () => {
    it("says what it is and lists its tools", async () => {
        const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
        expect(init.body.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "trip-planner" } });
        expect(init.body.result.instructions).toContain("share link");
        // An unknown version gets the newest.
        expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).body.result.protocolVersion).toBe("2025-11-25");

        const note = await server(new Request(`${ORIGIN}/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) }));
        expect(note.status).toBe(202);
        const names = (await rpc("tools/list")).body.result.tools.map((t: { name: string }) => t.name);
        expect(names).toEqual(["get_trip", "create_trip", "update_trip", "add_places", "update_place", "move_place", "remove_place", "add_day", "remove_day", "move_day", "search_places"]);

        expect((await rpc("nope")).body.error?.code).toBe(-32601);
        expect((await server(new Request(`${ORIGIN}/mcp`, { method: "POST", body: "{" }))).status).toBe(400);
        expect((await server(new Request(`${ORIGIN}/mcp`))).status).toBe(405);
        // Not from a page on another site.
        expect((await rpc("tools/list", {}, { Origin: "https://evil.example.com" })).status).toBe(403);
        // A batch.
        const batch = await server(new Request(`${ORIGIN}/mcp`, { method: "POST", body: JSON.stringify([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }]) }));
        expect(await batch.json()).toEqual([{ jsonrpc: "2.0", id: "a", result: {} }]);
    });

    it("reads share links of every kind", () => {
        expect(readLink("https://plan.thedylone.com/Xk3f9QmT2aLp7RvB")).toEqual({ token: "Xk3f9QmT2aLp7RvB" });
        expect(readLink("Xk3f9QmT2aLp7RvB")).toEqual({ token: "Xk3f9QmT2aLp7RvB" });
        expect(readLink("https://travel.thedylone.com/planner/#join=Xk3f9QmT2aLp7RvB")).toEqual({ token: "Xk3f9QmT2aLp7RvB" });
        expect(readLink("https://plan.thedylone.com/p/Xk3f9QmT2aLp7RvB")).toEqual({ token: "Xk3f9QmT2aLp7RvB" });
        const id = "0b7c6f0e-4a8e-4f61-9d39-1d3f4f2c9a10";
        expect(readLink(`https://x.workers.dev/p/${id}.${"a".repeat(64)}`)).toEqual({ id, token: "a".repeat(64) });
        expect(readLink("https://plan.thedylone.com/")).toBeUndefined();
        expect(readLink("Xk3f9QmT2aLp7RvBextra")).toBeUndefined();
    });

    it("plans a new trip that a phone then opens", async () => {
        const made = await call("create_trip", { title: "Kansai in spring", start: "2027-04-03", end: "2027-04-05", country: "JP" });
        expect(made.trip).toMatchObject({ title: "Kansai in spring", start: "2027-04-03", end: "2027-04-05", country: "jp", places_to_visit: [] });
        expect(made.trip.days.map((d: { date: string }) => d.date)).toEqual(["2027-04-03", "2027-04-04", "2027-04-05"]);
        const link: string = made.trip.link;
        expect(link).toMatch(/^https:\/\/sync\.example\.com\/[A-Za-z0-9_-]{16}$/);

        const added = await call("add_places", {
            link,
            places: [
                { day: 1, place: "Fushimi Inari", note: "Go early" },
                { day: 1, place: "Kinkaku-ji", position: 1 },
                { day: 0, place: "Nara" },
                { day: 2, place: "Somewhere made up" },
                { day: 2, place: "Arashiyama", name: "Bamboo grove", lat: 35.017, lng: 135.671, side: true },
            ],
        });
        const t = added.trip;
        expect(t.days[0].places.map((x: { place: string }) => x.place)).toEqual(["Kinkaku-ji", "Fushimi Inari"]);
        expect(t.days[0].places[1]).toMatchObject({ address: "Kyoto, Japan", lat: 34.9671, lng: 135.7727, note: "Go early" });
        expect(t.places_to_visit[0]).toMatchObject({ place: "Nara", lat: 34.6851 });
        expect(t.days[1].places[0]).toMatchObject({ place: "Somewhere made up", on_map: false });
        expect(t.days[1].places[1]).toMatchObject({ name: "Bamboo grove", side: true, lat: 35.017 });
        expect(added.notes).toEqual([
            '"Fushimi Inari" was found as Fushimi Inari Taisha, Kyoto, Japan (34.9671, 135.7727)',
            '"Kinkaku-ji" was found as Kinkaku-ji, Kyoto, Japan (35.0394, 135.7292)',
            '"Nara" was found as Nara, Japan (34.6851, 135.8048)',
            "\"Somewhere made up\" wasn't found on the map, so it isn't on it; give lat and lng to put it there",
        ]);
        // Each looked up near the place before it.
        expect(searches[0]).not.toContain("lat=");
        expect(searches[1]).toContain("lat=34.9671");

        // A phone opens the link: it's a plan like any other.
        const phone = await join({ secret: readLink(link)!.token }, []);
        expect(phone.title).toBe("Kansai in spring");
        expect(phone.days[0].places[1]).toMatchObject({ place: "Fushimi Inari", lat: 34.9671, side: false, name: "" });
        expect(phone.shared?.version).toBe(2);
    });

    it("edits a phone's shared trip, and merges with the phone's own changes", async () => {
        const mine = await share(phonePlan());
        const link = `${ORIGIN}/${mine.shared!.secret}`;
        const trip = (await call("get_trip", { link })) as { days: { places: { id: string }[] }[] };
        expect(trip.days[0].places[0].id).toBe("kyoto");

        await call("update_place", { link, id: "kyoto", note: "Stay near the station" });
        await call("add_places", { link, places: [{ day: 4, place: "Nara" }] });
        // Meanwhile, offline, the phone renamed the trip and added a place.
        const edited: Plan = { ...mine, title: "japan!", days: [mine.days[0], { ...mine.days[1], places: [newPlace({ key: "osaka", place: "Osaka" })] }] };
        const synced = await sync(edited);
        expect(synced.title).toBe("japan!");
        expect(synced.days.map((d) => d.places.map((x) => x.place))).toEqual([["Kyoto"], ["Osaka"], [], ["Nara"]]);
        expect(synced.days[0].places[0].note).toBe("Stay near the station");

        // Moves, days and dates.
        const nara = synced.days[3].places[0].key;
        let t = (await call("move_place", { link, id: nara, day: 2, position: 1 })).trip;
        expect(t.days[1].places.map((x: { place: string }) => x.place)).toEqual(["Nara", "Osaka"]);
        t = (await call("move_day", { link, day: 2, to: 1 })).trip;
        expect(t.days[0].places.map((x: { place: string }) => x.place)).toEqual(["Nara", "Osaka"]);
        t = (await call("add_day", { link, before: 1 })).trip;
        expect(t.days).toHaveLength(5);
        expect(t.end).toBe("2027-04-07");
        t = (await call("remove_day", { link, day: 2 })).trip;
        expect(t.places_to_visit.map((x: { place: string }) => x.place)).toEqual(["Nara", "Osaka"]);
        t = (await call("update_trip", { link, start: "2027-05-01" })).trip;
        expect([t.start, t.end]).toEqual(["2027-05-01", "2027-05-04"]);
        t = (await call("update_trip", { link, end: "2027-05-01", title: "Kyoto" })).trip;
        expect(t).toMatchObject({ title: "Kyoto", end: "2027-05-01" });
        expect(t.places_to_visit.map((x: { place: string }) => x.place)).toEqual(["Nara", "Osaka", "Kyoto"]);
        t = (await call("remove_place", { link, id: "kyoto" })).trip;
        expect(t.places_to_visit).toHaveLength(2);

        // A renamed place is looked up again; one not found comes off the map.
        const id = t.places_to_visit[1].id;
        t = (await call("update_place", { link, id, place: "Kinkaku-ji" })).trip;
        expect(t.places_to_visit[1]).toMatchObject({ place: "Kinkaku-ji", lat: 35.0394, address: "Kyoto, Japan" });
        t = (await call("update_place", { link, id, place: "Nowhere" })).trip;
        expect(t.places_to_visit[1]).toMatchObject({ place: "Nowhere", on_map: false });

        // And the phone gets it all.
        const after = await sync(synced);
        expect(after.title).toBe("Kyoto");
        expect(after.days).toHaveLength(1);
    });

    it("says what's wrong, so the agent can fix it", async () => {
        const mine = await share(phonePlan());
        const link = `${ORIGIN}/${mine.shared!.secret}`;
        await expect(call("get_trip", {})).rejects.toThrow("link is needed");
        await expect(call("get_trip", { link: "https://example.com/hello" })).rejects.toThrow("isn't a share link");
        await expect(call("get_trip", { link: `${ORIGIN}/Zk3f9QmT2aLp7RvB` })).rejects.toThrow("no trip at that link");
        await expect(call("move_place", { link, id: "nope", day: 1 })).rejects.toThrow("no place with id nope");
        await expect(call("add_places", { link, places: [{ place: "x" }] })).rejects.toThrow("needs a day");
        await expect(call("add_places", { link, places: [{ place: "x", day: 1, lat: 3 }] })).rejects.toThrow("lat and lng together");
        await expect(call("update_trip", { link, start: "2027-02-30" })).rejects.toThrow("should be a date");
        await expect(call("update_trip", { link, start: "2027-05-01", end: "2027-04-01" })).rejects.toThrow("end is before start");
        await expect(call("remove_day", { link, day: 9 })).rejects.toThrow("the trip has 2 days");
        const { body } = await rpc("tools/call", { name: "delete_trip", arguments: { link } });
        expect(body.error?.code).toBe(-32602);
        // Nothing changed.
        expect((await sync(mine)).shared?.version).toBe(1);
    });

    it("looks places up", async () => {
        const r = await call("search_places", { query: "nara", near_lat: 35, near_lng: 135.7, country: "jp" });
        expect(r.results).toEqual([{ name: "Nara", address: "Japan", lat: 34.6851, lng: 135.8048 }]);
        expect(searches[0]).toContain("lat=35");
        expect((await call("search_places", { query: "nara", country: "fr" })).results).toEqual([]);
    });
});
