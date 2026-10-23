# Gym Desk

Self-hosted training and food tracker. One container, one SQLite file.

- **Train:** Push / Pull / Legs rotation, set logging, rest timer, bike finisher, progression prompts
- **Food:** barcode scan, search (Open Food Facts + USDA), custom foods, grams, daily calories and protein
- **Log:** sessions, lift trends, bodyweight with a 7-day average
- Works offline at the gym: changes queue on the phone and sync when signal returns
- Installs to the Android home screen as an app (PWA)

## Run on Unraid

1. Clone the repo onto the server:
   ```sh
   cd /mnt/user/appdata
   git clone https://github.com/<owner>/gym-desk.git gym-desk-src
   mkdir -p /mnt/user/appdata/gym-desk && chown 99:100 /mnt/user/appdata/gym-desk
   ```
2. Copy `.env.example` to `.env` and fill it in (see [Settings](#settings)).
3. Start it, either from the **Compose Manager** plugin (point a new stack at `gym-desk-src`) or over SSH:
   ```sh
   cd /mnt/user/appdata/gym-desk-src && docker compose up -d --build
   ```
4. Check it's up: `http://<unraid-ip>:8085`

## Cloudflare Tunnel

1. Zero Trust → **Networks → Tunnels** → your tunnel → **Public hostname** → add:
   - Hostname: `gym.<your-domain>`
   - Service: `http://<unraid-ip>:8085` (or `http://gym-desk:8080` if cloudflared shares a Docker network with it)
2. Zero Trust → **Access → Applications** → add a self-hosted app for `gym.<your-domain>`:
   - Policy: allow your email only
   - Session duration: 1 month, so the phone app doesn't keep asking
3. On your phone, open `https://gym.<your-domain>` in Chrome → menu → **Install app**.

The camera only works over HTTPS, which the tunnel provides.

## Update

```sh
cd /mnt/user/appdata/gym-desk-src && git pull && docker compose up -d --build
```

Keep Gym Desk out of any container auto-update. The phone picks up the new version the next time the app is opened.

## Backup

- **In the app:** Plan → Settings → Backup → Download (one JSON file with everything)
- **On the server:** back up `/mnt/user/appdata/gym-desk` (the database is `gym-desk.db`)
- **Restore:** Plan → Settings → Import, and choose a backup file. Importing merges; it won't duplicate entries.

## Settings

| Variable | What it does |
|---|---|
| `APP_PASSWORD` | Optional password screen. Leave blank when Cloudflare Access is in front. |
| `USDA_API_KEY` | Free key from [api.data.gov](https://api.data.gov/signup/) for whole-food search. Blank uses the shared demo key, which runs out quickly. |
| `OFF_COUNTRY` | Open Food Facts country filter for search (default `australia`). Barcode lookups are always worldwide. |
| `DATA_PATH` | Where the database lives on the host. |
| `TZ` | Server time zone. |

## Develop

```sh
npm install
npm run dev     # http://localhost:8080, data in ./data
npm test
```

Node 22.13 or newer (uses the built-in `node:sqlite`). The front end is plain JavaScript in `public/`, with no build step.

## Data sources

- [Open Food Facts](https://world.openfoodfacts.org): packaged products and barcodes (ODbL). Products you add from the label stay in your own database.
- [USDA FoodData Central](https://fdc.nal.usda.gov): whole foods (public domain). Values are per 100 g raw unless the name says cooked.
