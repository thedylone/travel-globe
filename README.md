# Travel History

Trips and places I've visited, on an interactive 3D globe:
**https://thedylone.github.io/travel-history**

- Nearby places merge into numbered clusters; zoom in (or click one) and they split apart.
- A place visited on several trips gets one pin with a multi-coloured ring, and its dialog has a tab per visit.
- Click a trip in the list to fly to it; links like `#trip=2024-02-iceland` or `#stop=2024-03-poland:2` open a view directly.
- Keys: **R** rotate, **D** day/night, **H** high-resolution textures, **Esc** back to all trips, **← →** photos.

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
| `npm run build` | production build into `dist/` |

## Deploying

Pushing to `main` builds and deploys with GitHub Actions (`.github/workflows/deploy.yml`); pull requests are
built and tested but not deployed. One-time setup: repo *Settings › Pages › Build and deployment › Source:
GitHub Actions*. `npm run deploy` still publishes `dist/` to the `gh-pages` branch by hand if needed.

## Layout

```
data/trips/*.yaml     one file per trip
data/bases.yaml       home/school/work, shown as icons; trips can start `from:` them
data/places.json      place name → coordinates (filled in automatically)
data/photos.json      processed photos (written by `npm run photos`)
photos/               original photos (not committed)
public/photos/        web versions (committed)
scripts/              import, photo processing, data loading and validation
src/lib/              places, clustering, dates, geo maths (unit tested)
src/components/       globe, trip panel, photo dialog
```
