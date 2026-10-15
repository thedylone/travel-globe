/**
 * Performance check: opens the built site in headless Chromium, then for each map style
 * counts the WebGL draw calls per frame and times a scripted drag and zoom.
 *
 *   npm run build && npm run perf
 *
 * Fails if a style goes over its draw-call budget (the reliable signal: 1,700 draw calls
 * a frame is what made the globe sluggish) or the page throws. Timings are printed but
 * don't fail the run, since they depend on the machine; headless Chromium renders on
 * the CPU, so frame rates here are far below a real GPU's.
 */
import fs from "node:fs";
import path from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { preview } from "vite";

/** Most draw calls a frame may take. ~100 today: tiles, trip arcs, borders as one object. */
const DRAW_CALL_BUDGET = 400;
/** Main-thread work during the drag and zoom above which a warning is printed. */
const LONG_TASK_WARN_MS = 500;

interface Scenario {
    name: string;
    settings: { style: "satellite" | "map"; borders?: boolean; night?: boolean };
}

const SCENARIOS: Scenario[] = [
    { name: "satellite", settings: { style: "satellite" } },
    { name: "satellite + borders", settings: { style: "satellite", borders: true } },
    { name: "satellite at night", settings: { style: "satellite", night: true } },
    { name: "map", settings: { style: "map" } },
];

const GPU_ARGS = ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const VIEWPORT = { width: 1400, height: 850 };

/** Counts every WebGL draw call, so a frame's count is the difference between two frames. */
const countDrawCalls = () => {
    const w = window as unknown as { __draws: number };
    w.__draws = 0;
    for (const proto of [WebGL2RenderingContext.prototype, WebGLRenderingContext.prototype] as unknown as Record<string, unknown>[]) {
        for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) {
            const original = proto[name] as ((...args: unknown[]) => unknown) | undefined;
            if (!original) continue;
            proto[name] = function (this: unknown, ...args: unknown[]) {
                w.__draws++;
                return original.apply(this, args);
            };
        }
    }
};

const drawCallsPerFrame = (page: Page) =>
    page.evaluate(
        () =>
            new Promise<number>((resolve) => {
                const w = window as unknown as { __draws: number };
                const counts: number[] = [];
                let last = w.__draws;
                const tick = () => {
                    counts.push(w.__draws - last);
                    last = w.__draws;
                    if (counts.length < 10) requestAnimationFrame(tick);
                    else resolve(Math.max(...counts.slice(1))); // the first is a partial frame
                };
                requestAnimationFrame(tick);
            })
    );

const watchLongTasks = (page: Page) =>
    page.evaluate(() => {
        const w = window as unknown as { __long: number[] };
        w.__long = [];
        new PerformanceObserver((list) => list.getEntries().forEach((e) => w.__long.push(e.duration))).observe({ type: "longtask" });
    });

const longTasks = (page: Page) => page.evaluate(() => (window as unknown as { __long: number[] }).__long);

/** A drag across the globe, then zooming in and back out. */
const dragAndZoom = async (page: Page) => {
    const x = VIEWPORT.width * 0.6;
    const y = VIEWPORT.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 0; i < 40; i++) await page.mouse.move(x + i * 8, y + Math.sin(i / 5) * 40);
    await page.mouse.up();
    await page.waitForTimeout(500);
    for (const dy of [-120, 120]) {
        for (let i = 0; i < 25; i++) {
            await page.mouse.wheel(0, dy);
            await page.waitForTimeout(30);
        }
        await page.waitForTimeout(800);
    }
};

/** tsx keeps function names by wrapping them in `__name(...)`, which the page doesn't have. */
const openPage = async (browser: Browser) => {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.addInitScript("window.__name = (f) => f");
    return page;
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ms = (n: number) => `${Math.round(n)} ms`;

const main = async () => {
    const dist = path.resolve("dist");
    if (!fs.existsSync(path.join(dist, "index.html"))) {
        console.error("No build found: run `npm run build` first.");
        process.exit(1);
    }
    const server = await preview({ preview: { port: 0, strictPort: false, open: false }, logLevel: "warn" });
    const url = server.resolvedUrls?.local[0];
    if (!url) throw new Error("vite preview didn't report a URL");

    const browser = await chromium.launch({ args: GPU_ARGS });
    const failures: string[] = [];
    const rows: string[][] = [["", "draw calls/frame", "long tasks (drag + zoom)", "longest"]];
    try {
        for (const { name, settings } of SCENARIOS) {
            const page = await openPage(browser);
            const errors: string[] = [];
            page.on("pageerror", (e) => errors.push(e.message));
            await page.addInitScript(countDrawCalls);
            await page.addInitScript((s) => {
                localStorage.setItem("travel-history:settings", JSON.stringify({ rotate: false, borders: false, night: false, ...s }));
                localStorage.setItem("travel-history:view", "globe");
            }, settings);
            await page.goto(url, { waitUntil: "networkidle" });
            await page.locator(".globe canvas").waitFor();
            await page.waitForTimeout(3000); // tiles and borders arrive

            const draws = await drawCallsPerFrame(page);
            await watchLongTasks(page);
            await dragAndZoom(page);
            const tasks = await longTasks(page);
            await page.close();

            rows.push([name, String(draws), `${tasks.length}, ${ms(sum(tasks))}`, ms(Math.max(0, ...tasks))]);
            if (draws > DRAW_CALL_BUDGET) failures.push(`${name}: ${draws} draw calls a frame (budget ${DRAW_CALL_BUDGET})`);
            if (sum(tasks) > LONG_TASK_WARN_MS) console.warn(`warning: ${name}: ${ms(sum(tasks))} of long tasks while dragging and zooming`);
            for (const e of errors) failures.push(`${name}: page error: ${e}`);
        }

        // Switching satellite → map paints the map texture: once ~10 s, now well under 1 s.
        const page = await openPage(browser);
        await page.addInitScript(() => localStorage.setItem("travel-history:settings", JSON.stringify({ style: "satellite", rotate: false })));
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(2000);
        await watchLongTasks(page);
        await page.keyboard.press("m");
        await page.waitForTimeout(3000);
        const tasks = await longTasks(page);
        await page.close();
        rows.push(["switch to map", "", `${tasks.length}, ${ms(sum(tasks))}`, ms(Math.max(0, ...tasks))]);
    } finally {
        await browser.close();
        await server.close();
    }

    const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
    for (const r of rows) console.log(r.map((c, i) => (i ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("   "));
    if (failures.length) {
        console.error(`\n${failures.length} problem(s):\n${failures.map((f) => `  ${f}`).join("\n")}`);
        process.exit(1);
    }
    console.log(`\nAll within budget (${DRAW_CALL_BUDGET} draw calls a frame).`);
};

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
