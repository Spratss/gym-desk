# Gym Desk

Self-hosted training and food tracker. One container, one SQLite file.

- **Train:** Push / Pull / Legs rotation, set logging, rest timer, bike finisher, progression prompts
- **Food:** barcode scan with torch, nutrition-label photo reading, search (Australian Food Composition Database, Open Food Facts, USDA fallback), recipes for batch cooking, saved meals, copy yesterday, grams
- **Targets:** calories and macros from height, weight, age, activity and goal, plus a weekly check-in that adjusts them from your real weight trend
- **Log:** sessions, lift trends, bodyweight with a 7-day average
- Works offline at the gym: changes queue on the phone and sync when signal returns
- Installs to the Android home screen as an app (PWA)

## Install on Unraid

Image: `ghcr.io/spratss/gym-desk:latest`

1. Create the data folder in the Unraid terminal:
   ```sh
   mkdir -p /mnt/user/appdata/gym-desk && chown 99:100 /mnt/user/appdata/gym-desk
   ```
2. Copy `unraid/gym-desk.xml` to the flash drive as `config/plugins/dockerMan/templates-user/my-gym-desk.xml`.
3. Docker tab → **Add Container** → Template: **gym-desk** → **Apply**.
4. Open `http://<server-ip>:8085`.

Or add the container by hand with these values:

| Field | Value |
|---|---|
| Repository | `ghcr.io/spratss/gym-desk:latest` |
| Network type | Bridge |
| Extra parameters | `--user 99:100` |
| Port | container `8080` → host `8085` |
| Path | container `/data` → host `/mnt/user/appdata/gym-desk` |
| Variables (optional) | see [Settings](#settings) |

Update from the Docker tab (**Check for updates** → **Apply update**). Leave it out of automatic updates.

## Install with Docker Compose (alternative)

```sh
git clone https://github.com/Spratss/gym-desk.git /mnt/user/appdata/gym-desk-src
cd /mnt/user/appdata/gym-desk-src && cp .env.example .env    # fill in
docker compose up -d --build
```
Update with `git pull && docker compose up -d --build`. Needs the Compose Manager plugin on Unraid.

## Cloudflare Tunnel

1. Zero Trust → **Networks → Tunnels** → your tunnel → **Public hostname** → add `gym.<your-domain>` → service `http://<server-ip>:8085`.
2. Zero Trust → **Access → Applications** → self-hosted app for `gym.<your-domain>`, policy: your email only, session duration: 1 month.
3. On your phone, open `https://gym.<your-domain>` in Chrome → menu → **Install app**.

The camera only works over HTTPS, which the tunnel provides.

## Backup

- **In the app:** Plan → Settings → Backup → Download (one JSON file with everything)
- **On the server:** back up `/mnt/user/appdata/gym-desk` (the database is `gym-desk.db`)
- **Restore:** Plan → Settings → Import. Importing merges and won't duplicate entries.

## Settings

| Variable | What it does |
|---|---|
| `APP_PASSWORD` | Optional password screen. Leave blank when Cloudflare Access is in front. |
| `USDA_API_KEY` | Free key from [api.data.gov](https://api.data.gov/signup/). Blank uses the shared demo key, which runs out quickly. |
| `ANTHROPIC_API_KEY` | Optional. Claude reads nutrition-label photos (more accurate). Without it, the server reads them with Tesseract OCR, privately and for free. Get a key at [console.anthropic.com](https://console.anthropic.com). |
| `ANTHROPIC_MODEL` | Model for label reading (default `claude-haiku-5-5`). |
| `USDA` | `auto` (default): only search USDA when Australian results are thin. `always` or `off`. |
| `OFF_COUNTRY` | Open Food Facts country filter for search (default `australia`). Barcode lookups are always worldwide. |
| `AFCD` | Set to `off` to leave out the Australian food database. |
| `AFCD_URL` | FSANZ download link used by **Update** in Settings, for when a new release comes out. |
| `TZ` | Server time zone (Unraid sets this automatically). |

## Scanning and label photos

- **Barcodes:** Chrome on Android reads them from the live camera (tap **Torch** in a dim kitchen). Other browsers can type the number.
- **Label photos:** on the **New** food screen, **Read the label from a photo** fills in calories, protein, carbs, fat and serving size from the nutrition panel. Fill the frame with the table, straight on, in good light, and check the numbers before saving. A product saved with its barcode is found instantly next time.

## Food data

- **[Australian Food Composition Database](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd)**, Food Standards Australia New Zealand (CC BY 4.0): 1,588 whole and basic foods with Australian values, per 100 g. Release 3 ships with the app (`server/data/afcd.json`), so nothing is downloaded. When FSANZ publishes a new release: Plan → Settings → Australian foods → **Update** (set `AFCD_URL` if the link changed) or **Upload** the "Nutrient profiles" spreadsheet. To update the bundled copy: `node scripts/build-afcd.js "<Nutrient profiles>.xlsx" "Release N"`.
- **[Open Food Facts](https://world.openfoodfacts.org)** (ODbL): packaged products and barcodes, contributed by users. Big brands are mostly there; supermarket house brands less so. Products you add from the label are saved, so the next scan finds them.
- **[USDA FoodData Central](https://fdc.nal.usda.gov)** (public domain): fallback for whole foods the Australian database doesn't have.

## Develop

```sh
npm install
npm run dev     # http://localhost:8080, data in ./data
npm test
```

Node 22.13 or newer (uses the built-in `node:sqlite`). The front end is plain JavaScript in `public/`, with no build step.

Pushes to `main` run the tests and publish the image to GHCR (`.github/workflows/docker.yml`).
