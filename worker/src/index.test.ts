import { describe, expect, it } from "vitest";
import { fakeServer } from "./fake";
import { dateRange, describePlan } from "../../src/planner/summary";

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

    it("shares by code, keeps each trip's picture, and shows it in the preview", async () => {
        const server = fakeServer();
        const CODE = "Xk3f9QmT2aLp7RvB";
        const api = (method: string, path = "", body?: BodyInit, type = "application/json", code = CODE) =>
            server(
                new Request(`https://sync.example.com/shared${path}`, {
                    method,
                    headers: { Authorization: `Bearer ${code}`, Origin: "https://travel.example.com", "Content-Type": type },
                    body,
                })
            );
        expect((await api("GET")).status).toBe(404);
        expect((await api("PUT", "", JSON.stringify({ version: 0, plan: plan() }))).status).toBe(200);
        expect(await (await api("GET")).json()).toEqual({ version: 1, plan: plan() });
        // Another code is another room; a room keeps its plan.
        expect((await api("GET", "", undefined, "", "Yk3f9QmT2aLp7RvB")).status).toBe(404);
        expect((await api("PUT", "", JSON.stringify({ version: 1, plan: { ...plan(), id: "0b7c6f0e-4a8e-4f61-9d39-000000000000" } }))).status).toBe(400);
        // A 64-character secret is only for /plans/<id>.
        expect((await api("GET", "", undefined, "", SECRET)).status).toBe(401);

        // No picture yet: the planner's.
        const page = () => server(new Request(`https://sync.example.com/p/${CODE}`)).then((r) => r.text());
        expect(await page()).toContain('content="https://travel.example.com/planner/preview.png"');
        expect(await page()).toContain(`location.replace("https://travel.example.com/planner/#join=${CODE}")`);

        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
        expect((await api("PUT", "/picture", jpeg, "text/plain")).status).toBe(415);
        expect((await api("PUT", "/picture", new Uint8Array(700 * 1024), "image/jpeg")).status).toBe(413);
        expect((await api("PUT", "/picture", jpeg, "image/jpeg", "Zk3f9QmT2aLp7RvB")).status).toBe(404);
        expect(await (await api("PUT", "/picture", jpeg, "image/jpeg")).json()).toEqual({ picture: 1 });
        expect(await (await api("GET")).json()).toMatchObject({ version: 1, picture: 1 });
        // Saving the plan keeps its picture.
        expect(await (await api("PUT", "", JSON.stringify({ version: 1, plan: plan("kyoto") }))).json()).toMatchObject({ version: 2, picture: 1 });

        expect(await page()).toContain(`content="https://sync.example.com/p/${CODE}/picture?v=1"`);
        const pic = await server(new Request(`https://sync.example.com/p/${CODE}/picture?v=1`));
        expect(pic.headers.get("Content-Type")).toBe("image/jpeg");
        expect(new Uint8Array(await pic.arrayBuffer())).toEqual(jpeg);
        expect((await server(new Request(`https://sync.example.com/p/Zk3f9QmT2aLp7RvB/picture`))).status).toBe(404);
    });
});
