/* ── News Reader App ── */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const root = document.documentElement;

  // ── Defaults ──
  const DEFAULT_FEEDS = [
    { id: "hn", name: "Hacker News", url: "https://hnrss.org/frontpage" },
    { id: "bbc", name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  ];

  // ── State ──
  let feeds = [];
  let articles = []; // { feedId, feedName, title, link, published, description, parsedDate }
  let savedArticles = []; // array of link strings
  let readArticles = []; // array of link strings
  let activeFeed = "all"; // "all" | "saved" | feedId
  let selectedArticle = null;
  let gridView = false;
  let sortOrder = "newest";
  let searchQuery = "";
  let autoRefreshTimer = null;

  // ── Persistence ──
  function load(key, fallback) {
    try {
      const raw = localStorage.getItem("nr_" + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function save(key, value) {
    try {
      localStorage.setItem("nr_" + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }

  function generateId() {
    return Math.random().toString(36).slice(2, 10);
  }

  // ── Load persisted state ──
  function loadState() {
    feeds = load("feeds", DEFAULT_FEEDS);
    savedArticles = load("saved", []);
    readArticles = load("read", []);
    gridView = load("gridView", false);
    sortOrder = load("sortOrder", "newest");

    // Accent color
    const accent = load("accent", null);
    if (accent) {
      root.style.setProperty("--accent", accent);
      const picker = $("accentColor");
      if (picker) picker.value = accent;
    }
  }

  // ── Accent color ──
  function initAccent() {
    const picker = $("accentColor");
    if (!picker) return;
    picker.addEventListener("input", () => {
      root.style.setProperty("--accent", picker.value);
      save("accent", picker.value);
    });
  }

  // ── Settings panel ──
  function initSettings() {
    const panel = $("settingsPanel");
    const openBtn = $("nrSettingsToggle");
    const closeBtn = $("settingsClose");
    if (!panel || !openBtn || !closeBtn) return;

    openBtn.addEventListener("click", () => {
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
      renderFeedManager();
    });

    closeBtn.addEventListener("click", () => {
      panel.classList.remove("open");
      panel.setAttribute("aria-hidden", "true");
    });

    panel.addEventListener("click", (e) => {
      if (e.target === panel) {
        panel.classList.remove("open");
        panel.setAttribute("aria-hidden", "true");
      }
    });

    // Auto-refresh
    const arSelect = $("nrAutoRefresh");
    if (arSelect) {
      arSelect.value = load("autoRefresh", "5");
      arSelect.addEventListener("change", () => {
        save("autoRefresh", arSelect.value);
        setupAutoRefresh();
      });
    }

    // Article limit
    const alSelect = $("nrArticleLimit");
    if (alSelect) {
      alSelect.value = load("articleLimit", "20");
      alSelect.addEventListener("change", () => {
        save("articleLimit", alSelect.value);
        refreshAllFeeds();
      });
    }

    // Export / import
    const exportBtn = $("nrExportFeeds");
    const importBtn = $("nrImportFeeds");
    const importFile = $("nrImportFile");

    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        const data = JSON.stringify({ feeds, savedArticles }, null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "news-reader-feeds.json";
        a.click();
      });
    }

    if (importBtn && importFile) {
      importBtn.addEventListener("click", () => importFile.click());
      importFile.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            if (Array.isArray(data.feeds)) {
              feeds = data.feeds;
              save("feeds", feeds);
            }
            if (Array.isArray(data.savedArticles)) {
              savedArticles = data.savedArticles;
              save("saved", savedArticles);
            }
            renderSidebar();
            refreshAllFeeds();
          } catch {
            alert("Invalid JSON file");
          }
        };
        reader.readAsText(file);
        importFile.value = "";
      });
    }
  }

  function renderFeedManager() {
    const container = $("nrFeedManager");
    if (!container) return;
    if (!feeds.length) {
      container.innerHTML = '<div class="muted" style="font-size:12px;padding:4px;">No feeds configured</div>';
      return;
    }
    container.innerHTML = feeds
      .map(
        (f) => `
      <div class="nr-feed-manager-item">
        <span class="nr-feed-manager-name" title="${escapeHtml(f.url)}">${escapeHtml(f.name)}</span>
        <button class="nr-feed-manager-delete" data-id="${f.id}" title="Remove feed">✕</button>
      </div>
    `
      )
      .join("");

    container.querySelectorAll(".nr-feed-manager-delete").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        feeds = feeds.filter((f) => f.id !== id);
        save("feeds", feeds);
        renderSidebar();
        renderFeedManager();
        if (activeFeed === id) {
          setActiveFeed("all");
        }
        refreshAllFeeds();
      });
    });
  }

  // ── Sidebar ──
  function renderSidebar() {
    const list = $("nrFeedList");
    if (!list) return;

    list.innerHTML = feeds
      .map(
        (f) => `
      <button class="nr-feed-btn${activeFeed === f.id ? " nr-feed-active" : ""}" data-feed="${f.id}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        <span>${escapeHtml(f.name)}</span>
        <span class="nr-feed-count" id="nrCount_${f.id}">0</span>
        <button class="nr-feed-delete nr-icon-btn-sm" data-delete="${f.id}" title="Remove feed">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </button>
    `
      )
      .join("");

    // Sidebar click handlers
    document.querySelectorAll(".nr-feed-btn[data-feed]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        // Don't activate if clicking delete
        if (e.target.closest("[data-delete]")) return;
        setActiveFeed(btn.dataset.feed);
      });
    });

    // Delete buttons
    list.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = btn.dataset.delete;
        feeds = feeds.filter((f) => f.id !== id);
        save("feeds", feeds);
        renderSidebar();
        if (activeFeed === id) setActiveFeed("all");
        // Remove articles from deleted feed
        articles = articles.filter((a) => a.feedId !== id);
        renderArticles();
        updateCounts();
      });
    });
  }

  function setActiveFeed(id) {
    activeFeed = id;
    selectedArticle = null;

    // Update active states
    document.querySelectorAll(".nr-feed-btn").forEach((btn) => {
      btn.classList.toggle("nr-feed-active", btn.dataset.feed === id);
    });

    // Update title
    const titleEl = $("nrCurrentFeedTitle");
    if (titleEl) {
      if (id === "all") titleEl.textContent = "All Feeds";
      else if (id === "saved") titleEl.textContent = "Saved Articles";
      else {
        const feed = feeds.find((f) => f.id === id);
        titleEl.textContent = feed ? feed.name : "Feed";
      }
    }

    renderArticles();
    showReadingEmpty();
  }

  // ── Fetch feeds ──
  async function fetchFeed(feed) {
    const limit = load("articleLimit", 20);
    try {
      const params = new URLSearchParams({ url: feed.url, limit });
      const res = await fetch(`/api/news?${params}`);
      const data = await res.json();

      if (data.error) {
        console.warn(`Feed error (${feed.name}):`, data.error);
        return [];
      }

      return (data.items || []).map((item) => ({
        feedId: feed.id,
        feedName: feed.name,
        title: item.title || "(no title)",
        link: item.link || "",
        published: item.published || "",
        description: item.description || "",
        thumbnail: item.thumbnail || "",
        author: item.author || "",
        parsedDate: parseDate(item.published),
      }));
    } catch (e) {
      console.error(`Fetch error (${feed.name}):`, e);
      return [];
    }
  }

  async function refreshAllFeeds() {
    const articlesEl = $("nrArticles");
    if (articlesEl) {
      articlesEl.innerHTML = '<div class="nr-loading">Loading feeds…</div>';
    }

    const results = await Promise.all(feeds.map((f) => fetchFeed(f)));
    articles = results.flat();
    sortArticles();
    renderArticles();
    updateCounts();
  }

  function parseDate(dateStr) {
    if (!dateStr) return new Date(0);
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? new Date(0) : d;
    } catch {
      return new Date(0);
    }
  }

  function sortArticles() {
    articles.sort((a, b) => {
      const ta = a.parsedDate.getTime();
      const tb = b.parsedDate.getTime();
      return sortOrder === "newest" ? tb - ta : ta - tb;
    });
  }

  // ── Render articles ──
  function getFilteredArticles() {
    let list = articles;

    // Filter by feed
    if (activeFeed === "saved") {
      list = list.filter((a) => savedArticles.includes(a.link));
    } else if (activeFeed !== "all") {
      list = list.filter((a) => a.feedId === activeFeed);
    }

    // Filter by search
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.feedName.toLowerCase().includes(q) ||
          (a.description && a.description.toLowerCase().includes(q))
      );
    }

    return list;
  }

  function renderArticles() {
    const container = $("nrArticles");
    if (!container) return;

    const filtered = getFilteredArticles();

    if (!filtered.length) {
      const msg =
        activeFeed === "saved"
          ? "No saved articles yet"
          : searchQuery
          ? "No articles match your search"
          : "No articles found";
      container.innerHTML = `<div class="nr-empty"><p>${msg}</p></div>`;
      container.classList.toggle("nr-grid-view", false);
      return;
    }

    container.classList.toggle("nr-grid-view", gridView);

    container.innerHTML = filtered
      .map((a, i) => {
        const isSelected = selectedArticle && selectedArticle.link === a.link;
        const isRead = readArticles.includes(a.link);
        const isSaved = savedArticles.includes(a.link);
        const snippet = stripHtml(a.description).slice(0, 120);
        const timeAgo = formatTimeAgo(a.parsedDate);

        return `
        <div class="nr-article-card${isSelected ? " nr-article-selected" : ""}${isRead ? " nr-article-read" : ""}" data-idx="${i}">
          <div class="nr-article-card-source">${escapeHtml(a.feedName)}</div>
          <div class="nr-article-card-title">${escapeHtml(a.title)}</div>
          ${snippet ? `<div class="nr-article-card-snippet">${escapeHtml(snippet)}</div>` : ""}
          <div class="nr-article-card-meta">
            <span>${timeAgo}</span>
            ${isSaved ? '<span class="nr-article-card-saved">★</span>' : ""}
          </div>
        </div>
      `;
      })
      .join("");

    // Click handlers
    container.querySelectorAll(".nr-article-card").forEach((card) => {
      card.addEventListener("click", () => {
        const idx = parseInt(card.dataset.idx);
        const a = filtered[idx];
        if (a) selectArticle(a);
      });
    });
  }

  function selectArticle(article) {
    selectedArticle = article;

    // Mark as read
    if (!readArticles.includes(article.link)) {
      readArticles.push(article.link);
      // Keep read list manageable
      if (readArticles.length > 500) readArticles = readArticles.slice(-300);
      save("read", readArticles);
    }

    renderArticles(); // update selection highlight

    // Show in reading pane
    const empty = $("nrReadingEmpty");
    const content = $("nrReadingContent");
    if (empty) empty.style.display = "none";
    if (content) content.style.display = "block";

    const titleEl = $("nrReadingTitle");
    const sourceEl = $("nrReadingSource");
    const dateEl = $("nrReadingDate");
    const bodyEl = $("nrReadingBody");
    const openEl = $("nrOpenExternal");

    if (titleEl) titleEl.textContent = article.title;
    if (sourceEl) sourceEl.textContent = article.feedName;
    if (dateEl) dateEl.textContent = formatDate(article.parsedDate);
    if (openEl) openEl.href = article.link;

    // Bookmark button state
    updateBookmarkBtn();

    // Mobile: show reading pane
    const pane = $("nrReadingPane");
    if (pane) pane.classList.add("nr-pane-visible");

    // Show RSS description immediately as a preview, then fetch full article
    if (bodyEl) {
      // Show thumbnail if available
      const thumbHtml = article.thumbnail
        ? `<img src="${escapeHtml(article.thumbnail)}" class="nr-reading-hero" alt="" />`
        : "";

      // Show author if available
      const authorHtml = article.author
        ? `<div class="nr-reading-author">By ${escapeHtml(article.author)}</div>`
        : "";

      const previewHtml = article.description
        ? sanitizeHtml(article.description)
        : '<p class="nr-reading-muted">Loading full article…</p>';

      bodyEl.innerHTML = thumbHtml + authorHtml +
        '<div class="nr-reading-text">' + previewHtml + '</div>' +
        '<div class="nr-reading-loading" id="nrArticleLoading">' +
        '<div class="nr-loading-spinner"></div> Loading full article…</div>';

      // Fetch full article content from the backend
      if (article.link) {
        fetchFullArticle(article.link, bodyEl, article);
      }
    }
  }

  async function fetchFullArticle(url, bodyEl, article) {
    try {
      const params = new URLSearchParams({ url });
      const res = await fetch(`/api/article?${params}`);
      const data = await res.json();

      // Only update if this article is still selected
      if (!selectedArticle || selectedArticle.link !== url) return;

      const loadingEl = $("nrArticleLoading");
      if (loadingEl) loadingEl.remove();

      if (data.error) {
        // Fall back to RSS description
        if (!article.description) {
          bodyEl.innerHTML +=
            `<p class="nr-reading-muted">Could not load full article.</p>
             <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="nr-read-more-link">Read on original site →</a>`;
        }
        return;
      }

      // Build rich article HTML
      let html = "";

      // Hero image
      if (data.top_image && !article.thumbnail) {
        html += `<img src="${escapeHtml(data.top_image)}" class="nr-reading-hero" alt="" />`;
      }

      // Authors
      if (data.authors && data.authors.length) {
        html += `<div class="nr-reading-author">By ${escapeHtml(data.authors.join(", "))}</div>`;
      } else if (article.author) {
        html += `<div class="nr-reading-author">By ${escapeHtml(article.author)}</div>`;
      }

      // Full article text as HTML paragraphs
      if (data.html) {
        html += `<div class="nr-reading-text">${sanitizeHtml(data.html)}</div>`;
      } else if (data.text) {
        const paragraphs = data.text.split(/\n\n+/).filter(p => p.trim());
        html += '<div class="nr-reading-text">' +
          paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join("") +
          '</div>';
      } else {
        // Keep the RSS description
        html += '<div class="nr-reading-text">' + sanitizeHtml(article.description || "") + '</div>';
      }

      // Read more link
      html += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="nr-read-more-link">Read on original site →</a>`;

      bodyEl.innerHTML = html;
    } catch (e) {
      console.error("Article fetch error:", e);
      const loadingEl = $("nrArticleLoading");
      if (loadingEl) loadingEl.remove();
    }
  }

  function showReadingEmpty() {
    const empty = $("nrReadingEmpty");
    const content = $("nrReadingContent");
    if (empty) empty.style.display = "flex";
    if (content) content.style.display = "none";

    const pane = $("nrReadingPane");
    if (pane) pane.classList.remove("nr-pane-visible");
  }

  function updateBookmarkBtn() {
    const btn = $("nrBookmarkArticle");
    if (!btn || !selectedArticle) return;
    const isSaved = savedArticles.includes(selectedArticle.link);
    btn.classList.toggle("nr-bookmark-active", isSaved);
    btn.title = isSaved ? "Unsave" : "Save";
  }

  // ── Counts ──
  function updateCounts() {
    const allCount = $("nrCountAll");
    const savedCount = $("nrCountSaved");

    if (allCount) allCount.textContent = articles.length;
    if (savedCount)
      savedCount.textContent = articles.filter((a) =>
        savedArticles.includes(a.link)
      ).length;

    feeds.forEach((f) => {
      const el = $("nrCount_" + f.id);
      if (el) el.textContent = articles.filter((a) => a.feedId === f.id).length;
    });
  }

  // ── Add Feed Modal ──
  function initAddFeedModal() {
    const overlay = $("nrModalOverlay");
    const addBtn = $("nrAddFeed");
    const closeBtn = $("nrModalClose");
    const cancelBtn = $("nrModalCancel");
    const saveBtn = $("nrModalSave");
    const nameInput = $("nrFeedName");
    const urlInput = $("nrFeedUrl");

    if (!overlay || !addBtn) return;

    function openModal() {
      if (nameInput) nameInput.value = "";
      if (urlInput) urlInput.value = "";
      overlay.style.display = "flex";
    }

    function closeModal() {
      overlay.style.display = "none";
    }

    addBtn.addEventListener("click", openModal);
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    // Preset chips
    document.querySelectorAll(".nr-preset-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        if (nameInput) nameInput.value = chip.dataset.name;
        if (urlInput) urlInput.value = chip.dataset.url;
      });
    });

    // Save
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        const name = (nameInput?.value || "").trim();
        const url = (urlInput?.value || "").trim();

        if (!name || !url) {
          alert("Please enter both a name and URL");
          return;
        }

        // Check for duplicates
        if (feeds.some((f) => f.url === url)) {
          alert("This feed URL already exists");
          return;
        }

        const newFeed = { id: generateId(), name, url };
        feeds.push(newFeed);
        save("feeds", feeds);

        closeModal();
        renderSidebar();

        // Fetch the new feed
        const newArticles = await fetchFeed(newFeed);
        articles = articles.concat(newArticles);
        sortArticles();
        renderArticles();
        updateCounts();
      });
    }
  }

  // ── Utilities ──
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function stripHtml(html) {
    if (!html) return "";
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  }

  function sanitizeHtml(html) {
    if (!html) return "";
    // Basic sanitization: allow safe tags, strip scripts
    const div = document.createElement("div");
    div.innerHTML = html;
    // Remove scripts and event handlers
    div.querySelectorAll("script, style, iframe, object, embed").forEach((el) => el.remove());
    div.querySelectorAll("*").forEach((el) => {
      for (const attr of [...el.attributes]) {
        if (attr.name.startsWith("on")) el.removeAttribute(attr.name);
      }
    });
    return div.innerHTML;
  }

  function formatTimeAgo(date) {
    if (!date || date.getTime() === 0) return "";
    const now = new Date();
    const diff = now - date;
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function formatDate(date) {
    if (!date || date.getTime() === 0) return "";
    return date.toLocaleDateString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // ── Event Wiring ──
  function initEvents() {
    // Refresh all
    const refreshBtn = $("nrRefreshAll");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", refreshAllFeeds);
    }

    // Search filter
    const searchInput = $("nrSearch");
    if (searchInput) {
      let debounce = null;
      searchInput.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => {
          searchQuery = searchInput.value.trim();
          renderArticles();
        }, 200);
      });
    }

    // Sort
    const sortSelect = $("nrSortSelect");
    if (sortSelect) {
      sortSelect.value = sortOrder;
      sortSelect.addEventListener("change", () => {
        sortOrder = sortSelect.value;
        save("sortOrder", sortOrder);
        sortArticles();
        renderArticles();
      });
    }

    // View toggle
    const viewBtn = $("nrViewToggle");
    if (viewBtn) {
      viewBtn.addEventListener("click", () => {
        gridView = !gridView;
        save("gridView", gridView);
        renderArticles();
      });
    }

    // Bookmark
    const bookmarkBtn = $("nrBookmarkArticle");
    if (bookmarkBtn) {
      bookmarkBtn.addEventListener("click", () => {
        if (!selectedArticle) return;
        const idx = savedArticles.indexOf(selectedArticle.link);
        if (idx >= 0) {
          savedArticles.splice(idx, 1);
        } else {
          savedArticles.push(selectedArticle.link);
        }
        save("saved", savedArticles);
        updateBookmarkBtn();
        updateCounts();
        renderArticles();
      });
    }

    // Sidebar "All" and "Saved" buttons
    document.querySelectorAll('.nr-feed-btn[data-feed="all"], .nr-feed-btn[data-feed="saved"]').forEach((btn) => {
      btn.addEventListener("click", () => setActiveFeed(btn.dataset.feed));
    });

    // Keyboard navigation
    document.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.tagName === "SELECT") return;

      const filtered = getFilteredArticles();
      if (!filtered.length) return;

      const currentIdx = selectedArticle
        ? filtered.findIndex((a) => a.link === selectedArticle.link)
        : -1;

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = Math.min(currentIdx + 1, filtered.length - 1);
        selectArticle(filtered[next]);
        scrollArticleIntoView(next);
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = Math.max(currentIdx - 1, 0);
        selectArticle(filtered[prev]);
        scrollArticleIntoView(prev);
      } else if (e.key === "o" || e.key === "Enter") {
        if (selectedArticle && selectedArticle.link) {
          window.open(selectedArticle.link, "_blank");
        }
      } else if (e.key === "s") {
        if (bookmarkBtn) bookmarkBtn.click();
      } else if (e.key === "r") {
        refreshAllFeeds();
      } else if (e.key === "Escape") {
        showReadingEmpty();
        selectedArticle = null;
        renderArticles();
      }
    });
  }

  function scrollArticleIntoView(idx) {
    const container = $("nrArticles");
    if (!container) return;
    const cards = container.querySelectorAll(".nr-article-card");
    if (cards[idx]) {
      cards[idx].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ── Auto-refresh ──
  function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    const mins = parseInt(load("autoRefresh", "5"));
    if (mins > 0) {
      autoRefreshTimer = setInterval(refreshAllFeeds, mins * 60 * 1000);
    }
  }

  // ── Init ──
  function init() {
    loadState();
    initAccent();
    initSettings();
    initAddFeedModal();
    initEvents();
    renderSidebar();
    refreshAllFeeds();
    setupAutoRefresh();
  }

  window.addEventListener("DOMContentLoaded", init);
})();
