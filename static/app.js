const root = document.documentElement;

function $(id) {
  return document.getElementById(id);
}

// Time & date
function updateClock() {
  const now = new Date();
  const timeEl = $("time");
  const dateEl = $("date");
  if (!timeEl || !dateEl) return;

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const date = now.toLocaleDateString([], {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  timeEl.textContent = time;
  dateEl.textContent = date;

  // Day progress (percentage of the current day that has passed)
  const progressText = $("dayProgressText");
  const progressFill = $("dayProgressFill");
  if (progressText && progressFill) {
    const secondsSinceMidnight =
      now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const totalSeconds = 24 * 60 * 60;
    const pct = Math.max(
      0,
      Math.min(100, (secondsSinceMidnight / totalSeconds) * 100),
    );
    progressText.textContent = `${pct.toFixed(0)}%`;
    progressFill.style.width = `${pct}%`;
  }
}

// Quick links (editable in code or from settings)
const DEFAULT_LINKS = [
  { label: "YouTube", url: "https://youtube.com", icon: "▶" },
  { label: "Gmail", url: "https://mail.google.com", icon: "✉" },
  { label: "GitHub", url: "https://github.com", icon: "⌥" },
  { label: "Reddit", url: "https://reddit.com", icon: "☰" },
];

function renderQuickLinks() {
  const c = $("quickLinks");
  if (!c) return;
  c.innerHTML = "";
  const links = loadSetting("quickLinks", DEFAULT_LINKS);
  links.forEach((l) => {
    const a = document.createElement("a");
    a.href = l.url;
    a.className = "quick-link";
    a.innerHTML = `<span class="icon">${l.icon ?? "⬤"}</span><span>${l.label}</span>`;
    c.appendChild(a);
  });
}

// Simple history buffers for live server graphs
const serverHistory = {
  cpu: [],
  mem: [],
};

function addToHistory(arr, value, max = 60) {
  if (!Number.isFinite(value)) return;
  arr.push(value);
  if (arr.length > max) arr.shift();
}

function serializeQuickLinks(links) {
  return links
    .map((l) => {
      const label = (l.label || "").trim();
      const url = (l.url || "").trim();
      const icon = (l.icon || "").trim();
      if (!label || !url) return null;
      return icon ? `${label},${url},${icon}` : `${label},${url}`;
    })
    .filter(Boolean)
    .join("\n");
}

function parseQuickLinks(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const [label, url, icon] = parts.map((p) => p.trim());
    if (!label || !url) continue;
    out.push({ label, url, icon: icon || "" });
  }
  return out.length ? out : DEFAULT_LINKS;
}

// Theme & customization
function loadSetting(key, fallback) {
  try {
    const raw = localStorage.getItem("home_" + key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function saveSetting(key, value) {
  try {
    localStorage.setItem("home_" + key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function initAccent() {
  const picker = $("accentColor");
  if (!picker) return;
  const stored = loadSetting("accent", null);
  if (stored) {
    root.style.setProperty("--accent", stored);
    picker.value = stored;
  }
  picker.addEventListener("input", () => {
    root.style.setProperty("--accent", picker.value);
    saveSetting("accent", picker.value);
  });
}

function initVisibilityToggles() {
  const weatherEl = $("weatherWidget");
  const serverEl = $("serverWidget");
  const weatherToggle = $("toggleWeather");
  const serverToggle = $("toggleServer");

  const weatherVisible = loadSetting("showWeather", true);
  const serverVisible = loadSetting("showServer", true);

  if (weatherToggle && weatherEl) {
    weatherToggle.checked = !!weatherVisible;
    weatherEl.style.display = weatherVisible ? "block" : "none";
    weatherToggle.addEventListener("change", () => {
      const show = weatherToggle.checked;
      weatherEl.style.display = show ? "block" : "none";
      saveSetting("showWeather", show);
    });
  }

  if (serverToggle && serverEl) {
    serverToggle.checked = !!serverVisible;
    serverEl.style.display = serverVisible ? "block" : "none";
    serverToggle.addEventListener("change", () => {
      const show = serverToggle.checked;
      serverEl.style.display = show ? "block" : "none";
      saveSetting("showServer", show);
    });
  }
}

function initQuickLinksEditor() {
  const textarea = $("quickLinksEditor");
  const saveBtn = $("quickLinksSave");
  const resetBtn = $("quickLinksReset");
  if (!textarea || !saveBtn || !resetBtn) return;

  const current = loadSetting("quickLinks", DEFAULT_LINKS);
  textarea.value = serializeQuickLinks(current);

  saveBtn.addEventListener("click", () => {
    const parsed = parseQuickLinks(textarea.value || "");
    saveSetting("quickLinks", parsed);
    renderQuickLinks();
  });

  resetBtn.addEventListener("click", () => {
    saveSetting("quickLinks", DEFAULT_LINKS);
    textarea.value = serializeQuickLinks(DEFAULT_LINKS);
    renderQuickLinks();
  });
}

// Settings panel
function initSettingsPanel() {
  const panel = $("settingsPanel");
  const openBtn = $("settingsToggle");
  const closeBtn = $("settingsClose");

  if (!panel || !openBtn || !closeBtn) return;

  function open() {
    panel.classList.add("open");
    panel.setAttribute("aria-hidden", "false");
  }

  function close() {
    panel.classList.remove("open");
    panel.setAttribute("aria-hidden", "true");
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);

  panel.addEventListener("click", (e) => {
    if (e.target === panel) {
      close();
    }
  });
}

// Weather
async function fetchWeather() {
  const body = $("weatherBody");
  if (!body) return;
  body.innerHTML = '<div class="muted">Loading weather…</div>';

  try {
    const pos = await new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation unavailable"));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 5000,
      });
    });

    const lat = pos.coords.latitude.toFixed(3);
    const lon = pos.coords.longitude.toFixed(3);

    const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
    const data = await res.json();

    if (!data.current_weather) {
      body.innerHTML = '<div class="muted">Weather unavailable</div>';
      return;
    }

    const cw = data.current_weather;
    const temp = Math.round(cw.temperature);
    const wind = Math.round(cw.windspeed);
    const code = Number(cw.weathercode ?? 0);
    const type = mapWeatherCodeToType(code);

    let hiLoLine = "";
    let sunLine = "";
    try {
      const daily = data.daily;
      const times = (daily && daily.time) || [];
      const maxes = (daily && daily.temperature_2m_max) || [];
      const mins = (daily && daily.temperature_2m_min) || [];
      const sunrises = (daily && daily.sunrise) || [];
      const sunsets = (daily && daily.sunset) || [];
      if (times.length && maxes.length && mins.length) {
        const todayIndex = 0; // API returns today first when timezone=auto
        const hi = Math.round(maxes[todayIndex]);
        const lo = Math.round(mins[todayIndex]);
        hiLoLine = `High ${hi}°F · Low ${lo}°F`;
        if (sunrises.length && sunsets.length) {
          const sr = new Date(sunrises[todayIndex]);
          const ss = new Date(sunsets[todayIndex]);
          const fmt = (d) =>
            d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          sunLine = `Sunrise ${fmt(sr)} · Sunset ${fmt(ss)}`;
        }
      }
    } catch {
      hiLoLine = "";
      sunLine = "";
    }

    const windDirDeg = Number(cw.winddirection ?? 0);
    const windDirText = degToCompass(windDirDeg);

    let updatedLine = "";
    try {
      const t = cw.time; // e.g. "2026-02-12T19:40"
      if (t) {
        const dt = new Date(t);
        const tm = dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        updatedLine = `Updated ${tm}`;
      }
    } catch {
      updatedLine = "";
    }

    // Build hourly forecast + graph for the rest of today
    let hourlyHtml = "";
    let hourlyTempsForGraph = [];
    try {
      const hourly = data.hourly;
      if (hourly && Array.isArray(hourly.time)) {
        const now = new Date();
        const cutoff = new Date(now.getTime() + 12 * 60 * 60 * 1000); // next 12h
        const times = hourly.time;
        const temps = hourly.temperature_2m || [];
        const pops = hourly.precipitation_probability || [];
        const codes = hourly.weathercode || [];

        const items = [];
        let minTemp = Infinity;
        let maxTemp = -Infinity;
        let maxPopOverall = 0;
        for (let i = 0; i < times.length; i += 1) {
          const tStr = times[i];
          if (!tStr) continue;
          const dt = new Date(tStr);
          if (dt < now || dt > cutoff) continue;
          const hourLabel = dt.toLocaleTimeString([], {
            hour: "numeric",
          });
          const ht = temps[i];
          const pop = pops[i];
          const hCode = Number(codes[i] ?? 0);
          const hType = mapWeatherCodeToType(hCode);
          const tempVal = Number(ht);
          const tempRounded = Math.round(tempVal);
          if (Number.isFinite(tempVal)) {
            if (tempVal < minTemp) minTemp = tempVal;
            if (tempVal > maxTemp) maxTemp = tempVal;
          }

          items.push({
            label: hourLabel,
            temp: tempRounded,
            rawTemp: tempVal,
            pop: Number.isFinite(pop) ? Math.round(pop) : null,
            type: hType,
          });
          if (Number.isFinite(pop) && pop > maxPopOverall) {
            maxPopOverall = pop;
          }
          if (items.length >= 8) break;
        }

        if (items.length) {
          // Build temperature graph path (scaled between min and max temps)
          if (!Number.isFinite(minTemp) || !Number.isFinite(maxTemp) || minTemp === maxTemp) {
            hourlyTempsForGraph = items.map(() => 50);
          } else {
            hourlyTempsForGraph = items.map((it) => {
              const v = Number(it.rawTemp);
              if (!Number.isFinite(v)) return 0;
              const pct = ((v - minTemp) / (maxTemp - minTemp)) * 100;
              return Math.max(0, Math.min(100, pct));
            });
          }

          hourlyHtml = `
            <div class="weather-graph-row">
              <div class="weather-graph">
                <svg class="weather-sparkline" viewBox="0 0 100 26" preserveAspectRatio="none">
                  <polyline points="${buildSparklinePath(hourlyTempsForGraph, 100, 26)}" class="weather-sparkline-line" />
                </svg>
              </div>
              <div class="weather-hourly">
              ${items
                .map((it) => {
                  const popText =
                    it.pop != null ? `<div class="weather-hour-pop">${it.pop}%</div>` : "";
                  return `
                    <div class="weather-hour">
                      <div class="weather-hour-time">${it.label}</div>
                      <div class="weather-hour-icon weather-${it.type}"></div>
                      <div class="weather-hour-temp">${it.temp}°</div>
                      ${popText}
                    </div>
                  `;
                })
                .join("")}
              </div>
            </div>
          `;
          if (maxPopOverall > 0) {
            const roundedMaxPop = Math.round(maxPopOverall);
            hourlyHtml += `
              <div class="weather-hourly-summary muted">Next 12h precip up to ${roundedMaxPop}%</div>
            `;
          }
        }
      }
    } catch {
      hourlyHtml = "";
    }

    body.innerHTML = `
      <div class="weather-main">
        <div class="weather-icon weather-${type}"></div>
        <div class="weather-info">
          <div class="weather-temp">${temp}°F</div>
          <div class="weather-meta">
            ${hiLoLine ? `<span>${hiLoLine}</span>` : ""}
            ${sunLine ? `<span>${sunLine}</span>` : ""}
            <span>Wind ${wind} mph ${windDirText}</span>
            <span class="muted">${updatedLine || `${lat}, ${lon}`}</span>
          </div>
        </div>
      </div>
      ${hourlyHtml}
    `;
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="muted">Unable to fetch weather</div>';
  }
}

function mapWeatherCodeToType(code) {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([80, 81, 82].includes(code)) return "shower";
  if ([95, 96, 99].includes(code)) return "storm";
  return "cloudy";
}

function degToCompass(deg) {
  if (!Number.isFinite(deg)) return "";
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  const i = Math.round((deg % 360) / 22.5) % 16;
  return dirs[i];
}

function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  let rem = s;
  const days = Math.floor(rem / 86400);
  rem %= 86400;
  const hours = Math.floor(rem / 3600);
  rem %= 3600;
  const mins = Math.floor(rem / 60);

  const parts = [];
  if (days) parts.push(`${days}d`);
  if (days || hours) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(" ");
}

function buildSparklinePath(values, width, height) {
  if (!values.length) return "";
  const maxPoints = values.length;
  const step = maxPoints > 1 ? width / (maxPoints - 1) : width;
  const pts = [];
  for (let i = 0; i < maxPoints; i += 1) {
    const v = Math.max(0, Math.min(100, Number(values[i] || 0)));
    const x = i * step;
    const y = height - (v / 100) * height;
    pts.push(`${x},${y}`);
  }
  return pts.join(" ");
}

// Server stats (live graphs + processes)
async function fetchServerStats() {
  const body = $("serverBody");
  if (!body) return;
  if (!body.dataset.ready) {
    body.innerHTML = '<div class="muted">Loading server stats…</div>';
  }

  try {
    const res = await fetch("/api/server-stats");
    const data = await res.json();

    if (data.error) {
      body.innerHTML = `<div class="muted">${data.error}</div>`;
      return;
    }

    const cpu = Number(data.cpu_percent || 0);
    const mem = data.memory || {};
    const memPct = Number(mem.percent || 0);
    const uptimeSeconds = Number(data.uptime_seconds || 0);
    const processes = Array.isArray(data.processes) ? data.processes : [];

    addToHistory(serverHistory.cpu, cpu);
    addToHistory(serverHistory.mem, memPct);

    const cpuPath = buildSparklinePath(serverHistory.cpu, 100, 26);
    const memPath = buildSparklinePath(serverHistory.mem, 100, 26);

    const rows = processes
      .slice(0, 5)
      .map((p) => {
        const nameRaw = (p.name || "(unknown)").toString();
        const name = nameRaw.length > 18 ? `${nameRaw.slice(0, 17)}…` : nameRaw;
        const pid = p.pid;
        const cpuP = Number(p.cpu_percent || 0).toFixed(1);
        const memP = Number(p.memory_percent || 0).toFixed(1);
        return `
          <div class="process-row">
            <div class="process-main">
              <span class="process-name">${name}</span>
              <span class="process-pid">PID ${pid}</span>
            </div>
            <div class="process-metrics">
              <span>${cpuP}% CPU</span>
              <span>${memP}% MEM</span>
            </div>
          </div>
        `;
      })
      .join("");

    const processesHtml =
      rows || '<div class="muted">No process data available</div>';

    body.innerHTML = `
      <div class="server-uptime">
        <div class="stat-label">Uptime</div>
        <div class="stat-value">${formatDuration(uptimeSeconds)}</div>
      </div>
      <div class="server-graphs">
        <div class="server-graph">
          <div class="stat-label">CPU</div>
          <div class="stat-sub">${cpu.toFixed(1)}%</div>
          <svg class="sparkline" viewBox="0 0 100 26" preserveAspectRatio="none">
            <polyline points="${cpuPath}" class="sparkline-line" />
          </svg>
        </div>
        <div class="server-graph">
          <div class="stat-label">Memory</div>
          <div class="stat-sub">${memPct.toFixed(1)}%</div>
          <svg class="sparkline" viewBox="0 0 100 26" preserveAspectRatio="none">
            <polyline points="${memPath}" class="sparkline-line" />
          </svg>
        </div>
      </div>
      <div class="server-processes">
        <div class="stat-label">Top processes</div>
        <div class="process-list">
          ${processesHtml}
        </div>
      </div>
    `;
    body.dataset.ready = "1";
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="muted">Unable to fetch stats</div>';
  }
}

function formatBytes(v) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = v;
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u += 1;
  }
  return `${n.toFixed(1)} ${units[u]}`;
}

function init() {
  updateClock();
  setInterval(updateClock, 30 * 1000);

  renderQuickLinks();
  initAccent();
  initVisibilityToggles();
  initSettingsPanel();
  initQuickLinksEditor();
  renderCalendar();

  const wRefresh = $("weatherRefresh");
  const sRefresh = $("serverRefresh");

  if (wRefresh) wRefresh.addEventListener("click", fetchWeather);
  if (sRefresh) sRefresh.addEventListener("click", fetchServerStats);

  fetchWeather();
  fetchServerStats();
  // Poll server stats periodically for live graphs
  setInterval(fetchServerStats, 5000);
}

window.addEventListener("DOMContentLoaded", init);

// News
async function fetchNews() {
  const body = $("newsBody");
  if (!body) return;
  body.innerHTML = '<div class="muted">Loading news…</div>';

  try {
    const res = await fetch("/api/news");
    const data = await res.json();

    if (!data.items || !data.items.length) {
      body.innerHTML = '<div class="muted">No news items</div>';
      return;
    }

    const list = document.createElement("div");
    list.className = "news-list";

    data.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "news-item";
      const source = formatNewsSource(item.link || "");
      row.innerHTML = `
        <a href="${item.link}" target="_blank" rel="noopener noreferrer">
          <div class="news-title">${item.title}</div>
          <div class="news-meta">${source}</div>
        </a>
      `;
      list.appendChild(row);
    });

    body.innerHTML = "";
    body.appendChild(list);
  } catch (e) {
    console.error(e);
    body.innerHTML = '<div class="muted">Unable to fetch news</div>';
  }
}

function renderCalendar() {
  const container = $("calendar");
  if (!container) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();

  const firstOfMonth = new Date(year, month, 1);
  const firstDay = firstOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const monthName = now.toLocaleDateString([], {
    month: "long",
  });

  const weekLabels = ["S", "M", "T", "W", "T", "F", "S"];

  let html = "";
  html += '<div class="calendar-header">';
  html += `<span class="calendar-month">${monthName.toUpperCase()}</span>`;
  html += `<span>${year}</span>`;
  html += "</div>";

  html += '<div class="calendar-grid">';
  weekLabels.forEach((d) => {
    html += `<div class="calendar-cell calendar-cell--label">${d}</div>`;
  });

  for (let i = 0; i < firstDay; i += 1) {
    html += '<div class="calendar-cell calendar-cell--muted"></div>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const isToday = day === today;
    const cls = isToday
      ? "calendar-cell calendar-cell--today"
      : "calendar-cell";
    html += `<div class="${cls}">${day}</div>`;
  }

  html += "</div>";

  container.innerHTML = html;
}

// Tidy up news meta presentation
function formatNewsSource(link) {
  try {
    const u = new URL(link);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
