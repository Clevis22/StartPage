from __future__ import annotations

import os
import time
from datetime import datetime

from flask import Flask, jsonify, render_template, send_from_directory
import psutil
import requests
import xml.etree.ElementTree as ET
import yfinance as yf


app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/server-stats")
def server_stats():
    load1, load5, load15 = os.getloadavg()
    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    cpu = psutil.cpu_percent(interval=0.2)
    net = psutil.net_io_counters()

    # Uptime in seconds since last boot
    uptime_seconds = int(time.time() - psutil.boot_time())

    # Top processes by memory usage
    processes: list[dict] = []
    try:
        for p in psutil.process_iter(["pid", "name", "cpu_percent", "memory_percent"]):
            try:
                info = p.info
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
            processes.append(
                {
                    "pid": info.get("pid"),
                    "name": info.get("name") or "(unknown)",
                    "cpu_percent": float(info.get("cpu_percent") or 0.0),
                    "memory_percent": float(info.get("memory_percent") or 0.0),
                }
            )

        processes.sort(key=lambda p: p["memory_percent"], reverse=True)
        processes = processes[:5]
    except Exception:
        processes = []

    return jsonify(
        {
            "time": datetime.utcnow().isoformat() + "Z",
            "load": {"1m": load1, "5m": load5, "15m": load15},
            "cpu_percent": cpu,
            "memory": {
                "total": mem.total,
                "used": mem.used,
                "percent": mem.percent,
            },
            "disk": {
                "total": disk.total,
                "used": disk.used,
                "percent": disk.percent,
            },
            "uptime_seconds": uptime_seconds,
            "processes": processes,
            "network": {
                "bytes_sent": net.bytes_sent,
                "bytes_recv": net.bytes_recv,
            },
        }
    )


@app.route("/api/weather")
def weather_proxy():
    """Simple proxy to Open-Meteo to avoid CORS issues.

    Expects query params ?lat=..&lon=..
    """
    from flask import request

    lat = request.args.get("lat")
    lon = request.args.get("lon")

    if not lat or not lon:
        return jsonify({"error": "lat and lon are required"}), 400

    # Basic Open-Meteo current weather API, configured for US units
    url = (
        "https://api.open-meteo.com/v1/forecast"
        "?latitude="
        + lat
        + "&longitude="
        + lon
        + "&current_weather=true&temperature_unit=fahrenheit&windspeed_unit=mph"
        + "&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset"
        + "&hourly=temperature_2m,precipitation_probability,weathercode,windspeed_10m"
        + "&forecast_days=1&timezone=auto"
    )

    try:
        r = requests.get(url, timeout=5)
        r.raise_for_status()
        data = r.json()
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    return jsonify(data)


@app.route("/api/news")
def news_feed():
    """Return a simple news feed from a public RSS source.

    Uses Hacker News front page RSS by default. You can change the
    NEWS_RSS_URL environment variable on your VPS to point to any
    other RSS/Atom feed.
    """

    feed_url = os.environ.get("NEWS_RSS_URL", "https://hnrss.org/frontpage")

    try:
        r = requests.get(feed_url, timeout=5)
        r.raise_for_status()
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    try:
        root = ET.fromstring(r.text)
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": f"parse error: {e}"}), 502

    items: list[dict] = []

    # RSS 2.0: channel/item
    channel = root.find("channel")
    entries = channel.findall("item") if channel is not None else []

    for item in entries[:10]:
        title_el = item.find("title")
        link_el = item.find("link")
        date_el = item.find("pubDate")

        title = title_el.text if title_el is not None else "(no title)"
        link = link_el.text if link_el is not None else ""
        published = date_el.text if date_el is not None else ""

        items.append({"title": title, "link": link, "published": published})

    return jsonify({"items": items})


@app.route("/api/stocks")
def stocks():
    """Return basic stock quote data for a list of tickers.

    Expects query param ?tickers=SYM1,SYM2,... and uses yfinance to
    fetch the most recent close and previous close to compute daily
    percentage change.
    """
    from flask import request

    raw = request.args.get("tickers", "")
    symbols = [s.strip().upper() for s in raw.split(",") if s.strip()]

    if not symbols:
        return jsonify({"quotes": []})

    quotes: list[dict] = []

    for sym in symbols:
        try:
            ticker = yf.Ticker(sym)
            hist = ticker.history(period="2d", interval="1d")
            if hist.empty:
                continue

            close = hist["Close"].iloc[-1]
            prev_close = hist["Close"].iloc[-2] if len(hist) > 1 else close

            close_f = float(close)
            prev_f = float(prev_close) if prev_close not in (None, 0) else close_f
            change = close_f - prev_f
            pct = (change / prev_f * 100.0) if prev_f else 0.0

            quotes.append(
                {
                    "symbol": sym,
                    "price": close_f,
                    "change": change,
                    "change_percent": pct,
                }
            )
        except Exception:
            # Skip tickers that fail to load
            continue

    return jsonify({"quotes": quotes})


@app.route("/favicon.ico")
def favicon():
    return send_from_directory(
        os.path.join(app.root_path, "static"), "favicon.ico", mimetype="image/x-icon"
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5001)), debug=True)
