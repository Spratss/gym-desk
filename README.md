# Gym Desk

Self-hosted training and food tracker. One container, one SQLite file.

- **Train:** Push / Pull / Legs rotation, set logging, rest timer, bike finisher, progression prompts
- **Food:** barcode scan, search (Australian Food Composition Database, Open Food Facts, USDA fallback), saved meals, copy yesterday, grams
- **Targets:** calories and macros from height, weight, age, activity and goal, plus a weekly check-in that adjusts them from your real weight trend
- **Log:** sessions, lift trends, bodyweight with a 7-day average
- Works offline at the gym: changes queue on the phone and sync when signal returns
- Installs to the Android home screen as an app (PWA)

## Install on Unraid (Add Container)

Every push to `main` runs the tests and publishes an image to `ghcr.io/spratss/gym-desk:latest` (GitHub → **Actions** shows the build).

**One-off setup**

1. **Make the image pullable.** GitHub → your profile → **Packages** → `gym-desk` → **Package settings** → **Change visibility** → Public. The image holds only app code; your data stays on the server. (To keep it private instead, run `docker login ghcr.io` on Unraid with a token that has `read:packages`. Unraid forgets that login on reboot, so updates fail until you log in again.)
2. **Create the data folder** in the Unraid terminal:
   ```sh
   mkdir -p /mnt/user/appdata/gym-desk && chown 99:100 /mnt/user/appdata/gym-desk
   ```
3. **Add the template.** Copy `unraid/gym-desk.xml` to the flash drive as `config/plugins/dockerMan/templates-user/my-gym-desk.xml`, either over the network (`\\<server>\flash\config\plugins\dockerMan\templates-user\`) or in the terminal with `nano /boot/config/plugins/dockerMan/templates-user/my-gym-desk.xml` and paste the file in.
4. **Create the container.** Docker tab → **Add Container** → Template: **gym-desk** (under User templates). Fill in the USDA key if you have one → **Apply**.
5. Open `http://<server-ip>:8085`. The first start downloads the Australian food database (about a minute). Plan → Settings shows when it's ready.
6. Optional: edit the container and set **Icon URL** to `http://<server-ip>:8085/icons/icon-192.png`.

**Without the template:** Add Container and fill in the same values by hand.

| Field | Value |
|---|---|
| Name | `gym-desk` |
| Repository | `ghcr.io/spratss/gym-desk:latest` |
| Network type | Bridge |
| Extra parameters (advanced view) | `--user 99:100` |
| Port | container `8080` → host `8085` |
| Path | container `/data` → host `/mnt/user/appdata/gym-desk` |
| Variables (optional) | `APP_PASSWORD`, `USDA_API_KEY`, `OFF_COUNTRY=australia` |

**Updating:** push to `main`, wait for the Actions build to go green, then Docker tab → **Check for updates** → **Apply update** on gym-desk. Keep it out of automatic container updates so you can read what changed first.

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
| `USDA` | `auto` (default): only search USDA when Australian results are thin. `always` or `off`. |
| `OFF_COUNTRY` | Open Food Facts country filter for search (default `australia`). Barcode lookups are always worldwide. |
| `AFCD` | Set to `off` to skip downloading the Australian food database. |
| `AFCD_URL` | Override the FSANZ download link when a new release comes out. |
| `TZ` | Server time zone (Unraid sets this automatically). |

## Food data

- **[Australian Food Composition Database](https://www.foodstandards.gov.au/science-data/food-nutrient-databases/afcd)** by Food Standards Australia New Zealand (CC BY 4.0): about 1,600 whole and basic foods with Australian values. Downloaded by the server on first start. If FSANZ moves the file, set `AFCD_URL` or upload the "Nutrient profiles" spreadsheet in Plan → Settings.
- **[Open Food Facts](https://world.openfoodfacts.org)** (ODbL): packaged products and barcodes, contributed by users. Big brands are mostly there; supermarket house brands less so. Products you add from the label are saved, so the next scan finds them.
- **[USDA FoodData Central](https://fdc.nal.usda.gov)** (public domain): fallback for whole foods the Australian database doesn't have.

## Develop

```sh
npm install
npm run dev     # http://localhost:8080, data in ./data
npm test
```

Node 22.13 or newer (uses the built-in `node:sqlite`). The front end is plain JavaScript in `public/`, with no build step.
