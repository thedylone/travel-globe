import { describe, expect, it } from "vitest";
import { fakeServer } from "./fake";
import { dateRange, describePlan } from "./preview";

const ID = "0b7c6f0e-4a8e-4f61-9d39-1d3f4f2c9a10";
const SECRET = "a".repeat(64);
const plan = (title = "japan") => ({ id: ID, title, days: [], ideas: [] });
const req = (method: string, body?: unknown, { secret = SECRET, id = ID, origin = "https://travel.example.com" } = {}) =>
    new Request(`https://sync.example.com/plans/${id}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, Origin: origin, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

describe("planner sync worker", () => {
    it("makes a plan, then saves only changes based on the newest version", async () => {
        const server = fakeServer();
        expect((await server(req("GET"))).status).toBe(404);

        const made = await server(req("PUT", { version: 0, plan: plan() }));
        expect(made.status).toBe(200);
        expect(made.headers.get("Access-Control-Allow-Origin")).toBe("https://travel.example.com");
        expect(await made.json()).toEqual({ version: 1, plan: plan() });

        expect(await (await server(req("PUT", { version: 1, plan: plan("japan!") }))).json()).toMatchObject({ version: 2 });
        // A save based on version 1 is now out of date: it gets the newest back, to merge with.
        const stale = await server(req("PUT", { version: 1, plan: plan("kyoto") }));
        expect(stale.status).toBe(409);
        expect(await stale.json()).toEqual({ version: 2, plan: plan("japan!") });
        // Making it again doesn't replace it.
        expect((await server(req("PUT", { version: 0, plan: plan("other") }))).status).toBe(409);
        expect(await (await server(req("GET"))).json()).toEqual({ version: 2, plan: plan("japan!") });
    });

    it("only opens a plan with its secret", async () => {
        const server = fakeServer();
        await server(req("PUT", { version: 0, plan: plan() }));
        expect((await server(req("GET", undefined, { secret: "b".repeat(64) }))).status).toBe(403);
        expect((await server(req("PUT", { version: 1, plan: plan("x") }, { secret: "b".repeat(64) }))).status).toBe(403);
        expect((await server(req("GET", undefined, { secret: "short" }))).status).toBe(401);
    });

    it("turns away other sites, other paths and things that aren't plans", async () => {
        const server = fakeServer();
        expect((await server(req("GET", undefined, { origin: "https://evil.example.com" }))).status).toBe(403);
        expect((await server(req("GET", undefined, { id: "../etc" }))).status).toBe(404);
        expect((await server(req("PUT", { version: 0, plan: { ...plan(), id: "0b7c6f0e-4a8e-4f61-9d39-000000000000" } }))).status).toBe(400);
        expect((await server(req("PUT", { version: 0, plan: "nope" }))).status).toBe(400);
        expect((await server(req("PUT", { version: 0, plan: { ...plan(), note: "x".repeat(600_000) } }))).status).toBe(413);
        const pre = await server(new Request(`https://sync.example.com/plans/${ID}`, { method: "OPTIONS", headers: { Origin: "https://travel.example.com" } }));
        expect(pre.status).toBe(204);
        expect(pre.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
    });

    it("gives share links a preview, then sends them on to the planner", async () => {
        const server = fakeServer();
        const days = [{ places: [{ place: "Tokyo, Japan", name: "" }, { place: "Shibuya Sky", name: "Shibuya" }] }, { places: [{ place: "Kyoto", name: "" }] }];
        await server(req("PUT", { version: 0, plan: { ...plan('japan <3 "26"'), start: "2026-12-20", days } }));
        const open = (secret: string) => server(new Request(`https://sync.example.com/p/${ID}.${secret}`));

        const res = await open(SECRET);
        expect(res.status).toBe(200);
        expect(res.headers.get("Content-Type")).toContain("text/html");
        expect(res.headers.get("Cache-Control")).toContain("no-store");
        const page = await res.text();
        expect(page).toContain('<meta property="og:title" content="japan &lt;3 &quot;26&quot;" />');
        expect(page).toContain("20–21 Dec 2026 · Tokyo, Shibuya and Kyoto. A shared trip plan.");
        expect(page).toContain('content="https://travel.example.com/planner/preview.png"');
        expect(page).toContain(`location.replace("https://travel.example.com/planner/#join=${ID}.${SECRET}")`);

        // The wrong secret doesn't show the plan, but still goes on (the planner says what's wrong).
        const wrong = await (await open("b".repeat(64))).text();
        expect(wrong).not.toContain("japan");
        expect(wrong).toContain(`#join=${ID}.${"b".repeat(64)}`);
        expect((await server(new Request(`https://sync.example.com/p/${ID}.short`))).status).toBe(404);
    });

    it("describes plans in a line", () => {
        expect(dateRange("2027-04-03", 7)).toBe("3–9 Apr 2027");
        expect(dateRange("2027-03-28", 6)).toBe("28 Mar – 2 Apr 2027");
        expect(dateRange("2026-12-30", 5)).toBe("30 Dec 2026 – 3 Jan 2027");
        expect(dateRange("2027-04-03", 1)).toBe("3 Apr 2027");
        expect(dateRange("", 3)).toBe("");
        const place = (name: string) => ({ place: name, name: "" });
        expect(describePlan({ title: " ", days: [{ places: ["A", "B", "C", "D", "E"].map(place) }, { places: [] }] })).toEqual({
            title: "A trip plan",
            description: "2 days · A, B, C and 2 more. A shared trip plan.",
        });
        expect(describePlan({ title: "x", days: [], country: "Japan" }).description).toBe("Japan. A shared trip plan.");
    });
});
