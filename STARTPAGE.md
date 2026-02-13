# Start Page / Home Dashboard

A personal browser start page you can host on your VPS. It provides:

- Google search bar
- Current time & date with "day progress" bar
- Calendar for the current month
- Weather via the free Open‑Meteo API (no API key)
- Server statistics for the VPS (CPU, memory, disk, uptime, top processes)
 - Horizontal stock ticker bar with daily gain/loss
- Dark, minimal, Apple‑inspired UI
- Customizable accent color and quick links

This document covers how the app works, how it is deployed on your Ubuntu VPS, and how to operate it day to day.

---

## 1. Architecture Overview

### 1.1 Components

- **Backend**
  - Python 3 + Flask app (`main.py`)
  - Exposes:
    - `GET /` – renders the start page HTML
    - `GET /api/weather` – proxy to Open‑Meteo
    - `GET /api/server-stats` – server metrics via `psutil`
    - `GET /api/news` – RSS → JSON (currently unused in UI; optional)
    - `GET /api/stocks` – stock quotes via `yfinance`
    - `GET /favicon.ico` – serves favicon from `static/`
- **Frontend**
  - Template: `templates/index.html`
  - Styles: `static/style.css`
  - Logic: `static/app.js`
  - Uses browser features:
    - `navigator.geolocation` for weather location (requires HTTPS or localhost)
    - `localStorage` for settings (accent color, widget visibility, quick links)
- **Metrics / Data Sources**
  - **Weather:** Open‑Meteo `v1/forecast` endpoint
  - **Server stats:** `psutil` and `os.getloadavg()`
  - **Stocks:** Yahoo Finance via the `yfinance` Python library
  - **(Optional) News:** RSS/Atom feeds via `xml.etree.ElementTree`
- **Production Stack**
  - Ubuntu VPS
  - Python virtual environment in project directory
  - Gunicorn WSGI server, managed by `systemd` (`startpage.service`)
  - Nginx reverse proxy on port 80 → Gunicorn
  - Domain `start.kvps.online` via Cloudflare (DNS and HTTPS proxy)
  - Optional Nginx HTTP basic auth for protection

### 1.2 High-Level Flow

1. Browser loads `https://start.kvps.online` (or your IP/port in dev).
2. Nginx receives the request and proxies it to Gunicorn on `127.0.0.1:8000`.
3. Gunicorn passes the request to the Flask `app` in `main.py`.
4. Flask serves `index.html` and static assets.
5. Frontend JS:
   - Updates time/date and day-progress bar.
   - Renders calendar.
   - Loads quick links and settings from `localStorage`.
   - Calls `/api/weather` (using browser geolocation) and `/api/server-stats`.
   - Draws graphs for weather and server stats.

---

## 2. Features

### 2.1 Hero Section (Top-Left Card)

- Digital clock (`HH:MM`, seconds optional in code) and human-readable date.
- "Day progress" bar showing how far through the current day you are.
- Google search form (submits queries to Google in a new tab).
- Quick links row:
  - Set of chips/buttons configured by default.
  - Fully editable from the settings panel.

### 2.2 Today Widget (Top-Right Card)

- Shows the current date and weekday.
- Day-progress percentage bar.
- Monthly calendar with the current day highlighted.

### 2.3 Weather Widget

- Uses browser geolocation to get latitude/longitude.
- Calls backend `/api/weather`, which proxies to Open‑Meteo with:
  - `current_weather=true`
  - `temperature_unit=fahrenheit`
  - `windspeed_unit=mph`
  - `daily=temperature_2m_max,temperature_2m_min,sunrise,sunset`
  - `hourly=temperature_2m,precipitation_probability,weathercode`
  - `forecast_days=1&timezone=auto`
- Displays:
  - Current temperature in °F.
  - Wind speed in mph and compass direction (e.g., NW).
  - Weather icon based on Open‑Meteo `weathercode`.
  - Today's high/low temperatures.
  - Sunrise and sunset times.
  - "Last updated" time.
  - Hourly strip (next ~12 hours):
    - Hour of day
    - Mini weather icon
    - Temperature
    - Precipitation probability (%)
  - Temperature sparkline graph across the next hours.
  - Summary line like: "Next 12h precip up to X%".

> **Note:** Geolocation only works in a secure context (HTTPS or `http://localhost`). Over plain `http://IP:port`, most browsers will block location access.

### 2.4 Server Stats Widget

- Backend gathers data via `psutil` and `os.getloadavg()`:
  - Load average (1m/5m/15m)
  - CPU usage (%)
  - Memory usage (total, used, percent)
  - Disk usage for root filesystem (total, used, percent)
  - Uptime (seconds since boot)
  - Top 5 processes by memory usage:
    - `name`, `pid`, `cpu_percent`, `memory_percent`
- Frontend displays:
  - Uptime in a human-readable form.
  - CPU usage sparkline graph (history over recent polls).
  - Memory usage sparkline graph.
  - List of top processes with CPU and memory percentages.
- The server widget polls `/api/server-stats` every few seconds (e.g., 5s).

### 2.5 Settings Panel

Opened via a floating gear button, slides in as a side panel.

- Accent color picker:
  - Adjusts a CSS custom property used for accents and highlights.
  - Persisted in `localStorage`.
- Widget visibility toggles:
  - Show/hide Weather widget.
  - Show/hide Server widget.
  - States are saved in `localStorage`.
- Quick links editor:
  - Textarea where each line uses the format:
    
    ```
    Label,https://example.com,icon(optional)
    ```
  - Save button:
    - Parses the textarea lines and saves them in `localStorage`.
    - Re-renders the quick links row in the hero card.
  - Reset button:
    - Restores a built-in default set of quick links.

---

## 3. Code Structure

> Paths in this section refer to the deployed project structure on the VPS, but the same layout can be mirrored locally.

### 3.1 Backend (`main.py`)

Key routes:

- `GET /`
  - Renders `templates/index.html`.

- `GET /api/server-stats`
  - Returns JSON like:
    
    ```json
    {
      "time": "2025-01-01T12:34:56Z",
      "load": {"1m": 0.12, "5m": 0.10, "15m": 0.08},
      "cpu_percent": 7.5,
      "memory": {"total": 1234567890, "used": 456789012, "percent": 37.0},
      "disk": {"total": 2345678901, "used": 987654321, "percent": 42.0},
      "uptime_seconds": 123456,
      "processes": [
        {"pid": 123, "name": "python", "cpu_percent": 1.2, "memory_percent": 3.4},
        ... up to 5 entries ...
      ]
    }
    ```

- `GET /api/weather?lat=...&lon=...`
  - Forwards to Open‑Meteo and returns its JSON payload directly (or lightly massaged) for the frontend.

- `GET /api/news`
  - Optional/legacy route; parses an RSS feed and returns a simplified list of items.

- `GET /favicon.ico`
  - Serves `static/favicon.ico`.

### 3.2 Frontend Template (`templates/index.html`)

Main layout:

- Root `.page` container with a two-column flex layout.
- Left column:
  - **Hero card** with time/date, search bar, and quick links.
  - **Server widget** showing uptime, graphs, and process list.
- Right column:
  - **Today widget** (day progress + calendar) at the top.
  - **Weather widget** taking the remaining space below.
- Floating settings button (`#settingsToggle`) and settings panel (`#settingsPanel`).

### 3.3 Styles (`static/style.css`)

- CSS variables (custom properties) for colors, radii, shadows.
- Dark background with subtle gradient or texture.
- Glass-style cards using `backdrop-filter: blur(...)` and mostly transparent backgrounds (minimal borders).
- Flexbox layout:
  - `.layout` is a row with left and right columns.
  - Today widget is auto-height; weather widget flexes to fill remaining space.
- Weather and server graphs:
  - Use inline SVGs for sparklines.
  - Classes to style lines, axes, labels.
- Settings panel:
  - Fixed-position side panel on the right.
  - Solid, slightly elevated background vs. transparent widgets.

### 3.4 Scripts (`static/app.js`)

Key areas:

- **Clock & calendar**
  - `updateClock()` – updates time/date and day-progress bar using the user's device clock (runs on an interval in the browser).
  - `renderCalendar()` – builds the current month grid and highlights today.

- **Settings & quick links**
  - `loadSetting(key)` / `saveSetting(key, value)` – wrappers for `localStorage` with a prefix.
  - `initAccent()` – wires up color input and applies CSS variable.
  - `initVisibilityToggles()` – shows/hides widgets and saves preferences.
  - `renderQuickLinks()` – reads stored links or defaults and renders them.
  - `serializeQuickLinks()` / `parseQuickLinks()` – convert between structured arrays and textarea text.
  - `initQuickLinksEditor()` – binds Save/Reset and populates the textarea.

- **Weather**
  - `fetchWeather()`:
    - Uses `navigator.geolocation.getCurrentPosition` to obtain lat/lon.
    - Calls `/api/weather` with those coordinates.
    - Renders current temp, high/low, wind, sunrise/sunset, hourly strip, hourly graph, and precip summary.
  - `mapWeatherCodeToType(code)` – maps Open‑Meteo codes to icon classes.
  - `degToCompass(deg)` – converts wind direction to compass string.

- **Server stats**
  - Maintains `serverHistory` arrays for CPU and memory usage.
  - `addToHistory(arr, value, max)` – keeps a rolling buffer.
  - `buildSparklinePath(values, width, height)` – returns `points` string for SVG `<polyline>`.
  - `fetchServerStats()` – polls the backend, updates history, and redraws the graphs and process list.

- **Stocks**
  - Ticker settings (symbols and visibility) are stored in `localStorage`.
  - `fetchStocks()` – calls `/api/stocks` and renders a continuously scrolling, color-coded marquee at the bottom of the page.

- **Initialization**
  - `init()`:
    - Starts clock interval.
    - Renders quick links and calendar.
    - Initializes accent, visibility, settings panel, and quick links editor.
    - Binds refresh buttons for Weather and Server.
    - Performs initial `fetchWeather()` and `fetchServerStats()` and sets up a repeating interval for server stats.

---

## 4. Running Locally

From your local project directory (e.g., `/Users/you/First Project`):

1. **Create and activate a virtual environment** (optional but recommended):

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies**:

   ```bash
  pip install flask psutil requests yfinance
   ```

3. **Run the Flask app directly**:

   ```bash
   python main.py
   ```

4. **Open in your browser**:

   - Visit `http://127.0.0.1:5000` (or whatever port `main.py` uses for dev).

5. **Weather & geolocation**:

   - For geolocation to work locally, either:
     - Use `http://localhost:5000`, or
     - Use HTTPS via a local dev certificate.

---

## 5. Production Deployment (Ubuntu VPS)

The following assumes the project lives at `/root/StartPage` on the VPS and runs under a virtual environment `.venv`.

### 5.1 Directory Layout on VPS

Typical layout:

```text
/root/StartPage
├── main.py
├── templates/
├── static/
├── .venv/
└── ... other files (e.g., requirements.txt)
```

### 5.2 Initial Setup

1. **Clone the repository** (if using GitHub):

   ```bash
   cd /root
   git clone https://github.com/<your-user>/StartPage.git
   cd StartPage
   ```

2. **Create virtual environment & install deps**:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
  pip install flask psutil requests yfinance gunicorn
   ```

3. **Test with Gunicorn manually**:

   ```bash
   ./.venv/bin/gunicorn -b 0.0.0.0:8000 main:app
   ```

   - Then visit `http://your-server-ip:8000` (ensure firewall allows port 8000) to confirm.

### 5.3 Systemd Service (Gunicorn)

Create `/etc/systemd/system/startpage.service`:

```ini
[Unit]
Description=Start Page Gunicorn Service
After=network.target

[Service]
User=root
WorkingDirectory=/root/StartPage
Environment="PATH=/root/StartPage/.venv/bin"
Environment="PORT=8000"
ExecStart=/root/StartPage/.venv/bin/gunicorn -b 0.0.0.0:8000 main:app
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Reload systemd and start the service:

```bash
sudo systemctl daemon-reload
sudo systemctl enable startpage
sudo systemctl start startpage
```

Check status and logs:

```bash
sudo systemctl status startpage
journalctl -u startpage -f
```

---

## 6. Nginx Reverse Proxy

Assuming:

- Gunicorn listens on `127.0.0.1:8000` or `0.0.0.0:8000`.
- You want Nginx on port 80 forwarding to Gunicorn.
- Domain: `start.kvps.online`.

### 6.1 Nginx Site Config

Create `/etc/nginx/sites-available/startpage`:

```nginx
server {
    listen 80;
    server_name start.kvps.online;

    # Optional HTTP basic auth
    # auth_basic "Restricted";
    # auth_basic_user_file /etc/nginx/.htpasswd;

    location /static/ {
        alias /root/StartPage/static/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and test:

```bash
sudo ln -s /etc/nginx/sites-available/startpage /etc/nginx/sites-enabled/startpage
sudo nginx -t
sudo systemctl reload nginx
```

Now `http://start.kvps.online` should proxy to the app.

### 6.2 Optional HTTP Basic Auth

To add a simple password prompt in front of the page:

1. Install `apache2-utils` (for `htpasswd`) if needed:

   ```bash
   sudo apt-get update
   sudo apt-get install apache2-utils
   ```

2. Create an `.htpasswd` file:

   ```bash
   sudo htpasswd -c /etc/nginx/.htpasswd yourusername
   ```

3. Uncomment the `auth_basic` lines in the Nginx config:

   ```nginx
   auth_basic "Restricted";
   auth_basic_user_file /etc/nginx/.htpasswd;
   ```

4. Reload Nginx:

   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

---

## 7. Cloudflare & HTTPS

### 7.1 DNS Setup

1. Add your domain (e.g., `kvps.online`) to Cloudflare.
2. Update your registrar to use Cloudflare's name servers.
3. In Cloudflare DNS:
   - Create an **A** record:
     - Name: `start`
     - Target: your VPS IP address
     - Proxy status: **Proxied** (orange cloud)

### 7.2 SSL/TLS Settings

In Cloudflare dashboard for the domain:

- SSL/TLS mode:
  - You can use **Flexible** (browser → Cloudflare over HTTPS, Cloudflare → origin over HTTP) or **Full** (if you install a cert on the VPS).
- Edge Certificates:
  - Enable **Always Use HTTPS** to redirect `http://` to `https://`.

Once this is set up, visiting `https://start.kvps.online` will:

- Hit Cloudflare over HTTPS.
- Cloudflare proxies to Nginx on your VPS.
- Nginx proxies to Gunicorn on port 8000.
- Flask serves your start page.

Geolocation will work in this configuration, because the browser sees a secure HTTPS origin.

> **Note:** Cloudflare Zero Trust / Access can further protect the app with identity-based auth, but that is optional and not required for basic use.

---

## 8. Day-to-Day Operations

### 8.1 Managing the Service

From the VPS:

- **Start service**:

  ```bash
  sudo systemctl start startpage
  ```

- **Stop service**:

  ```bash
  sudo systemctl stop startpage
  ```

- **Restart service** (after code changes):

  ```bash
  sudo systemctl restart startpage
  ```

- **Check status**:

  ```bash
  sudo systemctl status startpage
  ```

- **View logs**:

  ```bash
  journalctl -u startpage -e
  journalctl -u startpage -f   # follow
  ```

### 8.2 Updating Code from GitHub

If your VPS copy is a Git clone:

```bash
cd /root/StartPage
sudo systemctl stop startpage
git pull
source .venv/bin/activate
pip install -r requirements.txt  # if you maintain one
sudo systemctl start startpage
```

Or simply:

```bash
cd /root/StartPage
git pull
sudo systemctl restart startpage
```

(Assuming dependencies stay compatible.)

### 8.3 Debugging

- If the service fails to start:
  - Check `sudo systemctl status startpage` for the error.
  - Check detailed logs with `journalctl -u startpage -f`.
- To bypass Gunicorn & systemd temporarily for debugging:

  ```bash
  cd /root/StartPage
  source .venv/bin/activate
  PORT=5001 python main.py
  ```

  Then visit `http://your-server-ip:5001` directly.

- To test connectivity from the server itself:

  ```bash
  curl -v http://127.0.0.1:8000/
  ```

- To check if port 8000 is listening:

  ```bash
  sudo ss -tulpn | grep 8000
  ```

---

## 9. Optional Cleanup & Enhancements

- **Remove unused News endpoint**:
  - If you no longer use the `/api/news` route or related JS, you can safely delete or comment it out to simplify the code.
- **Add more metrics**:
  - Server widget could be extended with:
    - Network throughput
    - Disk I/O
    - Per-core CPU usage
- **Security tightening**:
  - Use Cloudflare firewall rules to restrict `start.kvps.online` to specific IP ranges (e.g., your home IP).
  - Consider Cloudflare Access (Zero Trust) if you want login-based protection.

---

## 10. Quick Reference

- **Local dev URL:** `http://127.0.0.1:5000` (or configured port)
- **Gunicorn URL on VPS:** `http://127.0.0.1:8000`
- **Public URL:** `https://start.kvps.online`
- **Service name:** `startpage`
- **Service control:** `sudo systemctl [start|stop|restart|status] startpage`
- **Service logs:** `journalctl -u startpage -f`
- **Nginx reload:** `sudo systemctl reload nginx`

This markdown file is meant to serve as your runbook and documentation for both development and operations of your Start Page project.