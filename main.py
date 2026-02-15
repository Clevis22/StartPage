from __future__ import annotations

import os
import time
from datetime import datetime

from flask import Flask, jsonify, render_template, request, send_from_directory
import psutil
import requests
import feedparser
import yfinance as yf


app = Flask(__name__, static_folder="static", template_folder="templates")


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/news")
def news_page():
    return render_template("news.html")


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
    """Return a news feed from an RSS source using feedparser.

    Accepts query params:
      ?url=<rss-feed-url>  (defaults to Hacker News)
      ?limit=<number>      (defaults to 20, max 50)
    """
    feed_url = request.args.get("url") or os.environ.get(
        "NEWS_RSS_URL", "https://hnrss.org/frontpage"
    )
    limit = min(int(request.args.get("limit", 20)), 50)

    try:
        parsed = feedparser.parse(
            feed_url,
            agent="StartPage/1.0",
        )
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    if parsed.bozo and not parsed.entries:
        err = str(getattr(parsed, "bozo_exception", "Unknown parse error"))
        return jsonify({"error": f"Feed error: {err}"}), 502

    feed_title = getattr(parsed.feed, "title", "") or ""

    items: list[dict] = []
    for entry in parsed.entries[:limit]:
        title = getattr(entry, "title", "(no title)")
        link = getattr(entry, "link", "")

        # Published date – try multiple feedparser fields
        published = ""
        for attr in ("published", "updated", "created"):
            val = getattr(entry, attr, None)
            if val:
                published = val
                break

        # Description / summary – prefer content, fall back to summary
        description = ""
        if hasattr(entry, "content") and entry.content:
            description = entry.content[0].get("value", "")[:2000]
        elif hasattr(entry, "summary"):
            description = (entry.summary or "")[:2000]
        elif hasattr(entry, "description"):
            description = (entry.description or "")[:2000]

        # Media thumbnail (for images if available)
        thumbnail = ""
        if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
            thumbnail = entry.media_thumbnail[0].get("url", "")
        elif hasattr(entry, "media_content") and entry.media_content:
            thumbnail = entry.media_content[0].get("url", "")

        # Author
        author = getattr(entry, "author", "")

        items.append({
            "title": title,
            "link": link,
            "published": published,
            "description": description,
            "thumbnail": thumbnail,
            "author": author,
        })

    return jsonify({"items": items, "feed_title": feed_title})


@app.route("/api/article")
def fetch_article():
    """Fetch and extract the full readable content of an article URL.

    Uses newspaper3k to download and parse the article, returning
    the cleaned text, top image, and authors.

    Query params:
      ?url=<article-url>
    """
    from newspaper import Article, ArticleException

    url = request.args.get("url", "").strip()
    if not url:
        return jsonify({"error": "url parameter is required"}), 400

    try:
        article = Article(url)
        article.download()
        article.parse()
    except ArticleException as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:  # noqa: BLE001
        return jsonify({"error": str(e)}), 502

    # Build HTML content from the text (preserve paragraphs)
    text = article.text or ""
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    html_content = "".join(f"<p>{p}</p>" for p in paragraphs) if paragraphs else ""

    return jsonify({
        "title": article.title or "",
        "authors": article.authors or [],
        "publish_date": article.publish_date.isoformat() if article.publish_date else "",
        "top_image": article.top_image or "",
        "text": text,
        "html": html_content,
        "source_url": url,
    })


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
