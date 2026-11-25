# Planner sync server

A small [Cloudflare Worker](https://developers.cloudflare.com/workers/) that lets several phones share a plan
in the trip planner and change it together. It runs on Cloudflare's free plan. There are no accounts:
**Share** in the planner makes a random secret that goes in the share link, and the Worker keeps only a hash of
it. Anyone with the link can see and change that plan, and nobody else can.

Each shared plan lives in its own [Durable Object](https://developers.cloudflare.com/durable-objects/), which
handles one request at a time. A phone's save says which version it was based on; if someone else saved first,
the save is turned away with the newest version, and the phone merges the two (`src/planner/merge.ts`) and
sends that. So two people editing at once never overwrite each other's changes.

The planner works without it. Until `sync:` is set in `site.yaml`, there's no Share button and plans stay on
each phone.

## One-time setup

You need a free Cloudflare account and Node.js. Run these from the `worker/` folder of a clone of this repo.

1. **Sign in to Cloudflare**

   ```sh
   npx wrangler@4 login
   ```

2. **Check the allowed origins** in `wrangler.toml`. `ALLOWED_ORIGINS` must list your site's address exactly,
   with no path or trailing slash (`https://travel.thedylone.com`, or `https://<you>.github.io`).
   `http://localhost:5173` is there for `npm run dev`.

3. **Deploy**

   ```sh
   npx wrangler@4 deploy
   ```

   It prints the Worker's address, like `https://planner-sync.<your-subdomain>.workers.dev`. The Durable
   Object needs no setup of its own: the deploy makes it.

4. **Check it's up**

   ```sh
   curl -i https://planner-sync.<your-subdomain>.workers.dev/plans/00000000-0000-0000-0000-000000000000
   ```

   A `401` with `missing or bad token` means it's working.

5. **Point the site at it**: add `sync: https://planner-sync.<your-subdomain>.workers.dev` to your data repo's
   `site.yaml` and push. Once the site has rebuilt, plans in the planner have a **Share** button.

## API

```
GET /plans/<id>                       -> { version, plan }
PUT /plans/<id>  { version, plan }    -> { version, plan }; 409 with the newest if `version` isn't it
GET /p/<id>.<secret>                  -> the share link's page (below)
```

Both take `Authorization: Bearer <secret>` (64 hex characters). A `PUT` with version 0 makes the plan, and that
secret is the plan's from then on.

## Share links and link previews

A share link is `https://planner-sync.<your-subdomain>.workers.dev/p/<id>.<secret>`. Chat apps don't run
scripts, so to show a preview they read the page's tags: the Worker answers with the plan's name, its dates and
first few places, and the planner's picture (`planner/preview.png`, made with the site), then sends the browser
on to `PLANNER_URL#join=<id>.<secret>`. The name only shows for the right secret, and the page is never cached
or indexed. Whoever gets the link (and the chat app making its preview) can see the plan anyway.

`PLANNER_URL` in `wrangler.toml` is where the planner is. Links from before this (`/planner/#join=…`) still work,
just without the trip's own preview.

## Limits

The free plan allows 100,000 requests and 100,000 rows written a day. A phone syncs a shared plan every 15
seconds while it's open on screen (a read, not a write) and a moment after each change, so two people planning
for hours stay far below that. Past a limit, syncing stops until midnight UTC, and the planner says it couldn't
sync; nothing is charged.

## Changing the code

The Worker is `src/index.ts`; its tests (`src/index.test.ts`) run with `npm test` from the repo root, along with
the planner's sync and merge tests (`src/planner/sync.test.ts`). Run `npx wrangler@4 deploy` again after
changing it.
