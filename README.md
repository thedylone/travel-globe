# Travel History

Trips and places I've visited, on an interactive 3D globe:
**https://thedylone.github.io/travel-history**

- Nearby places merge into numbered clusters; zoom in (or click one) and they split apart.
- A place visited on several trips gets one pin with a multi-coloured ring, and its dialog has a tab per visit.
- Click a trip in the list to fly to it; links like `#trip=2024-02-iceland` or `#stop=2024-03-poland:2` open a view directly.
- **Timeline**: a calendar with a row per year and a bar per trip. Click a bar to fly there, or **Play** to fly
  through every trip in order.
- **Satellite** imagery loads as map tiles, so it gets sharper as you zoom in (down to ~10 m per pixel).
  **Map** style draws country borders as vectors (crisp at any zoom) and shades the countries you've been to;
  **Borders** overlays them on the satellite view.
- **2D** view: a flat world map with visited countries shaded, your places, the headline numbers, the share
  of the world's countries you've been to, and how many of each continent's.
  **Share image** turns it into a PNG sized for an Instagram post, a story or a link preview, in dark or light.
- **Layers** (top right): map type, borders, night, rotation, and the theme: Dark (the default), Light, or
  Auto to follow your device. The globe itself stays in
  space either way. The default is `DEFAULT_THEME` in `src/lib/theme.ts`.
- Keys: **R** rotate, **D** day/night, **M** satellite/map, **B** borders, **V** 3D/2D, **T** timeline,
  **P** play, **Esc** back to all trips, **← →** photos.

```sh
npm install
npm run dev        # http://localhost:5173/travel-history/
```

## Adding a trip

### From photos (easiest)

Export the trip's photos from your phone or camera into a folder, then:

```sh
npm run import -- ~/Desktop/iceland --title "iceland" --from school
```

This reads the time and GPS position in each photo, groups them into stops (a new stop whenever you moved more
than 15 km; change with `--km`), names each stop from OpenStreetMap, copies the originals into
`photos/iceland/<stop>/`, makes the web-sized versions, and writes a draft `data/trips/2024-02-iceland.yaml`.

Open the draft, fix up names and dates, and that's it. `npm run dev` shows it on the globe straight away.

- Photos without GPS join the stop they were taken during. Photos with neither a time nor GPS go to `photos/<trip>/unsorted/`.
- Re-sort photos by moving the files between stop folders, then `npm run photos`.
- HEIC isn't supported: export as JPEG (on iPhone: *Settings › Camera › Formats › Most Compatible*, or *File › Export* in Photos).
  Messaging apps often strip GPS, so export from the photo library itself.

### By hand

Create `data/trips/<yyyy-mm>-<name>.yaml`. Only `place` and `date` are needed per stop:

```yaml
title: poland
from: school            # a key from data/bases.yaml, or any place name
stops:
  - place: Kraków       # looked up on OpenStreetMap the first time
    date: 2024-03-07..2024-03-09
    photos: krakow      # every photo in photos/krakow/

  - place: Auschwitz-Birkenau Memorial
    name: auschwitz     # label on the globe, if different from `place`
    date: 2024-03-08
    photos: [auschwitz/1, auschwitz/3]   # or pick photos (extension optional)
    note: Optional text shown with the photos.

  - place: Warsaw
    lat: 52.2297        # exact coordinates instead of a lookup
    lng: 21.0122
    date: 2024-03-09..2024-03-10
```

Optional at the top: `to:` (where the trip ended, if not where it started) and `country: pl` to steer lookups
(e.g. so "Cambridge" isn't the one in Massachusetts).

Then run `npm run check`. It validates every trip file, looks up new places and saves them to
`data/places.json` (commit that file; if a lookup is wrong, fix the coordinates there or add `lat`/`lng` to the stop).
The dev server and build do the same checks and point at the file and stop with the problem.

## Photos

Original photos live in `photos/` and **aren't committed** (they're large, and contain GPS data).
`npm run photos` turns them into:

| | |
| --- | --- |
| `public/photos/full/<id>.webp` | longest side 1600 px, metadata (incl. GPS) removed |
| `public/photos/thumb/<id>.webp` | 480 px thumbnails |
| `public/photos/full/<id>.mp4` | videos and animated GIFs, max 1280 px (needs [ffmpeg](https://ffmpeg.org/download.html)) |
| `data/photos.json` | what's available, checked against trip files |

`<id>` is the path under `photos/` without the extension, e.g. `photos/iceland/12.jpg` → `iceland/12`.
Only new or changed photos are processed; `--force` redoes all of them, and `--prune` removes web versions
whose original is gone (it's off by default, so a fresh clone without `photos/` loses nothing).

Keep a backup of `photos/` somewhere (cloud drive, external disk). The originals that used to be in
`public/images/` are still in git history; to get them back into `photos/`:

```sh
mkdir -p photos
git ls-tree -d -z --name-only fb00002 public/images/ | xargs -0 git archive fb00002 | tar -x --strip-components=2 -C photos
```

## Commands

| | |
| --- | --- |
| `npm run dev` | dev server; reloads when anything in `data/` changes |
| `npm run import -- <folder>` | draft a trip from a folder of photos |
| `npm run photos` | make web versions of new photos in `photos/` |
| `npm run check` | validate `data/`, look up new places |
| `npm test` | unit tests |
| `npm run build` | production build into `dist/`, including the stats images |
| `npm run perf` | performance check of the build (below) |
| `npm run stats-image -- <folder>` | render just the stats images |

## Performance check

`npm run perf` opens the build in headless Chromium and, for each map style, counts the WebGL draw calls per
frame and times a scripted drag and zoom, plus the switch from satellite to map:

```
                      draw calls/frame   long tasks (drag + zoom)   longest
satellite                           99                    0, 0 ms      0 ms
satellite + borders                100                    0, 0 ms      0 ms
map                                 83                    0, 0 ms      0 ms
switch to map                                           2, 816 ms    750 ms
```

It fails if a style goes over 400 draw calls a frame or the page throws; CI runs it on every push and pull
request. Draw calls are the dependable number (drawing each border as its own object once took ~1,700 a frame and
made the globe sluggish). The timings depend on the machine and only print a warning: headless Chromium renders
on the CPU, so it's far slower than a real GPU. The first run needs a browser: `npx playwright install chromium`.

## Deploying

Pushing to `main` builds and deploys with GitHub Actions (`.github/workflows/deploy.yml`); pull requests are
built and tested but not deployed. One-time setup: repo *Settings › Pages › Build and deployment › Source:
GitHub Actions*. `npm run deploy` still publishes `dist/` to the `gh-pages` branch by hand if needed.

## Stats image

Every build renders the stats card into the site, so these always show the latest numbers:

| | |
| --- | --- |
| https://thedylone.github.io/travel-history/stats.png | 1080×1350, Instagram post |
| https://thedylone.github.io/travel-history/stats-story.png | 1080×1920, stories |
| https://thedylone.github.io/travel-history/stats-wide.png | 1200×630, also the site's link preview |

Each also comes in light: `stats-light.png`, `stats-story-light.png`, `stats-wide-light.png`.

Embed one anywhere that takes an image URL, e.g. in a GitHub profile README:

```md
[![My travels](https://thedylone.github.io/travel-history/stats.png)](https://thedylone.github.io/travel-history)
```

`npm run stats-image -- <folder>` renders them locally. The card is drawn by `src/lib/share.ts`, shared with the
in-app **Share image** button, in the bundled [Bricolage Grotesque](https://github.com/ateliertriay/bricolage)
font (`public/fonts`, SIL Open Font License). A country is shaded where you have a stop on or within ~1,200 km of
that land mass, so a trip to Paris doesn't colour in French Guiana.

Percentages count the world as 195 countries (the 193 UN members plus Vatican City and Palestine), using the
[world-countries](https://github.com/mledoze/countries) dataset (ODbL) for each country's continent. Central America
and the Caribbean count as North America. Places that aren't among the 195 (Greenland, Hong Kong) still show on the
map and in the country count, but not in the percentages.

## Imagery and borders

| | Source | Licence |
| --- | --- | --- |
| Day | [Sentinel-2 cloudless 2024](https://s2maps.eu) by EOX, ~10 m/pixel | CC BY-NC-SA 4.0: free for non-commercial use, with the credit shown on the globe |
| Night | [NASA City Lights 2012](https://earthdata.nasa.gov/gibs) via GIBS, ~600 m/pixel | Public domain |
| Borders | [Natural Earth](https://www.naturalearthdata.com) 1:50m via `world-atlas` | Public domain |

Tiles are loaded straight from those servers (no API keys). Stops are matched to countries at build time
(`scripts/lib/countries.ts`) for the country count and the shading in map style.

## Layout

```
data/trips/*.yaml     one file per trip
data/bases.yaml       home/school/work, shown as icons; trips can start `from:` them
data/places.json      place name → coordinates (filled in automatically)
data/photos.json      processed photos (written by `npm run photos`)
photos/               original photos (not committed)
public/photos/        web versions (committed)
scripts/              import, photo processing, data loading and validation
src/lib/              places, clustering, timeline, dates, geo maths (unit tested)
src/components/       globe, 2D map, trip panel, timeline, photo and share dialogs
```
