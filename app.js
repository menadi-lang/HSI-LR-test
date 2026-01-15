/* eslint-disable no-console */
(() => {
  const STATE = {
    all: [],
    filtered: [],
    expanded: new Set(),
    scenarios: [],
    filters: {
      q: "",
      sa1: false,
      sa2: false,
      sa3: false,
      training: "all",     // all | yes | no
      modelBased: "all",   // all | None | Conceptual | Formal
      scenarios: new Set(),
      sort: "year_desc"
    }
  };

  const els = {
    q: document.getElementById("q"),
    sa1: document.getElementById("sa1"),
    sa2: document.getElementById("sa2"),
    sa3: document.getElementById("sa3"),
    training: document.getElementById("training"),
    modelBased: document.getElementById("modelBased"),
    scenarioList: document.getElementById("scenarioList"),
    chips: document.getElementById("chips"),
    status: document.getElementById("status"),
    tbody: document.getElementById("tbody"),
    cards: document.getElementById("cards"),
    sort: document.getElementById("sort"),
    exportCsv: document.getElementById("exportCsv"),
    clearAll: document.getElementById("clearAll"),
    toggleFilters: document.getElementById("toggleFilters"),
    filtersPanel: document.getElementById("filtersPanel")
  };

  // ===== CSV loading + parsing (no libs) =====

  function normStr(s) { return String(s ?? "").trim(); }

  function escapeHtml(str) {
    const s = String(str ?? "");
    return s.replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[m]));
  }

  // Robust-ish CSV parser with quotes + commas inside quotes
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(cur);
        cur = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = "";
      } else {
        cur += ch;
      }
    }
    // last cell
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    // remove empty trailing lines
    return rows.filter(r => r.some(c => normStr(c).length));
  }

  function valueFromRow(rowObj, keyCandidates) {
    for (const k of keyCandidates) {
      if (k in rowObj) return rowObj[k];
    }
    return "";
  }

  function saBoolFromRating(r) {
    // treat Y and P as "addressed" for filtering (same as your UI badges)
    const v = normStr(r).toUpperCase();
    return v === "Y" || v === "P";
  }

  function trainingBoolFromYN(v) {
    const s = normStr(v).toUpperCase();
    if (s === "Y" || s === "YES" || s === "TRUE") return true;
    if (s === "N" || s === "NO" || s === "FALSE") return false;
    return null;
  }

  function parseYearFromPaper(paperCell, yearCell) {
    const y = parseInt(normStr(yearCell), 10);
    if (!Number.isNaN(y)) return y;
    const m = normStr(paperCell).match(/\b(19|20)\d{2}\b/);
    return m ? parseInt(m[0], 10) : null;
  }

  function normalizeModelBased(v) {
    const s = normStr(v);
    if (!s) return "—";
    const t = s.toLowerCase();
    if (t.includes("formal")) return "Formal";
    if (t.includes("concept")) return "Conceptual";
    if (t.includes("none") || t === "—" || t.includes("no")) return "None";
    // keep as-is if already correct
    if (s === "None" || s === "Conceptual" || s === "Formal") return s;
    return s;
  }

  function metricsArrayFromCell(cell) {
    const s = normStr(cell);
    if (!s || s === "—") return [];
    // split common separators safely
    return s.split(/;|,|\||·|•/g).map(x => normStr(x)).filter(Boolean);
  }

  // Map Notion CSV headers -> locked schema keys.
  // This supports common variants so you don't need to rename columns.
  function rowFromNotion(rowObj) {
    const paper = valueFromRow(rowObj, [
      "Paper (Title — Author, Year)",
      "Paper (Author, Year)",
      "Paper",
      "Title",
      "Paper Title — Author, Year",
      "Name"
    ]);

    const scenario = valueFromRow(rowObj, ["Scenario / Domain", "Scenario", "Domain"]);
    const swarmType = valueFromRow(rowObj, ["Swarm Type"]);
    const humanRole = valueFromRow(rowObj, ["Human Role"]);

    const sa1 = valueFromRow(rowObj, ["SA1 (Perception)", "SA1"]);
    const sa2 = valueFromRow(rowObj, ["SA2 (Comprehension)", "SA2"]);
    const sa3 = valueFromRow(rowObj, ["SA3 (Projection)", "SA3"]);

    const trainingInc = valueFromRow(rowObj, ["Training Included (Y/N)", "Training Included", "Training"]);
    const trainingType = valueFromRow(rowObj, ["Training Type"]);
    const modelBased = valueFromRow(rowObj, ["Model-Based Support (None / Conceptual / Formal)", "Model-Based Support", "Model-Based"]);

    const iface = valueFromRow(rowObj, ["Interface / Visualization", "Interface"]);
    const evalRaw = valueFromRow(rowObj, ["Evaluation Metrics", "Evaluation"]);
    const contrib = valueFromRow(rowObj, ["Key Contribution"]);
    const lim = valueFromRow(rowObj, ["Main Limitation"]);
    const rel = valueFromRow(rowObj, ["Relevance to My PhD", "Relevance"]);

    // best-effort title/authors split for search/sort
    const titleGuess = normStr(paper).split("—")[0].trim();
    const authorsYear = normStr(paper).split("—")[1]?.trim() || "";
    const yearGuess = parseYearFromPaper(paper, rowObj["Year"] || rowObj["year"] || "");
    const authorsGuess = authorsYear.replace(/\b(19|20)\d{2}\b/g, "").replace(/^[, ]+|[, ]+$/g, "");

    return {
      paper: normStr(paper) || "—",
      title: titleGuess || "—",
      authors: authorsGuess || "—",
      year: yearGuess,

      scenario_domain: normStr(scenario) || "—",
      swarm_type: normStr(swarmType) || "—",
      human_role: normStr(humanRole) || "—",

      sa1_rating: normStr(sa1) || "—",
      sa2_rating: normStr(sa2) || "—",
      sa3_rating: normStr(sa3) || "—",

      sa1: saBoolFromRating(sa1),
      sa2: saBoolFromRating(sa2),
      sa3: saBoolFromRating(sa3),

      training_included: trainingBoolFromYN(trainingInc),
      training_type: normStr(trainingType) || "—",

      model_based_support: normalizeModelBased(modelBased),

      interface_visualization: normStr(iface) || "—",
      evaluation_metrics_raw: normStr(evalRaw) || "—",
      evaluation_metrics: metricsArrayFromCell(evalRaw),

      key_contribution: normStr(contrib) || "—",
      main_limitation: normStr(lim) || "—",
      relevance_to_phd: normStr(rel) || "—"
    };
  }

  function deriveScenarios(papers) {
    const set = new Set();
    papers.forEach(p => set.add(normStr(p.scenario_domain) || "—"));
    return [...set].sort((a, b) => a.localeCompare(b));
  }

  // ===== UI rendering (same behavior as before) =====

  function paperId(p) {
    const base = normStr(p.paper) || `${normStr(p.title)}-${normStr(p.authors)}-${p.year}`;
    return base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function trainingYN(v) { return v === true ? "Y" : v === false ? "N" : "—"; }

  function safeCell(v) {
    const s = normStr(v);
    return s.length ? escapeHtml(s) : "—";
  }

  function badgeHtml(rating) {
    const v = normStr(rating).toUpperCase();
    const cls =
      v === "Y" ? "badge badge--y" :
      v === "P" ? "badge badge--p" :
      v === "N" ? "badge badge--n" :
      "badge badge--dash";
    return `<span class="${cls}">${v || "—"}</span>`;
  }

  function buildScenarioList() {
    els.scenarioList.innerHTML = "";
    const frag = document.createDocumentFragment();

    STATE.scenarios.forEach((sc) => {
      const id = `sc_${paperId({ paper: sc })}`;
      const wrap = document.createElement("label");
      wrap.className = "scenario-item";
      wrap.setAttribute("for", id);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.id = id;
      cb.checked = STATE.filters.scenarios.has(sc);
      cb.addEventListener("change", () => {
        if (cb.checked) STATE.filters.scenarios.add(sc);
        else STATE.filters.scenarios.delete(sc);
        renderAll();
      });

      const text = document.createElement("span");
      text.textContent = sc;

      wrap.appendChild(cb);
      wrap.appendChild(text);
      frag.appendChild(wrap);
    });

    els.scenarioList.appendChild(frag);
  }

  function sortPapers(arr) {
    const s = STATE.filters.sort;
    const copy = arr.slice();

    if (s === "year_asc") copy.sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
    else if (s === "year_desc") copy.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    else if (s === "title_asc") copy.sort((a, b) => normStr(a.title).localeCompare(normStr(b.title)));
    else if (s === "title_desc") copy.sort((a, b) => normStr(b.title).localeCompare(normStr(a.title)));

    return copy;
  }

  function applyFilters() {
    const { q, sa1, sa2, sa3, training, modelBased, scenarios } = STATE.filters;
    const query = q.trim().toLowerCase();

    const out = STATE.all.filter((p) => {
      if (sa1 && p.sa1 !== true) return false;
      if (sa2 && p.sa2 !== true) return false;
      if (sa3 && p.sa3 !== true) return false;

      if (training === "yes" && p.training_included !== true) return false;
      if (training === "no" && p.training_included !== false) return false;

      if (modelBased !== "all" && normStr(p.model_based_support) !== modelBased) return false;

      if (scenarios.size > 0 && !scenarios.has(normStr(p.scenario_domain))) return false;

      if (query.length > 0) {
        const hay = [
          p.paper, p.title, p.authors, p.scenario_domain, p.swarm_type, p.human_role,
          p.training_type, p.model_based_support, p.interface_visualization, p.evaluation_metrics_raw,
          (p.evaluation_metrics || []).join(" "),
          p.key_contribution, p.main_limitation, p.relevance_to_phd
        ].map(normStr).join(" ").toLowerCase();

        if (!hay.includes(query)) return false;
      }

      return true;
    });

    STATE.filtered = sortPapers(out);
  }

  function renderStatus() {
    els.status.textContent = `${STATE.filtered.length} / ${STATE.all.length} papers shown`;
  }

  function renderChips() {
    const chips = [];
    const { q, sa1, sa2, sa3, training, modelBased, scenarios } = STATE.filters;

    if (q.trim()) chips.push({ type: "q", label: "Search", value: q.trim() });
    if (sa1) chips.push({ type: "sa1", label: "SA", value: "SA1" });
    if (sa2) chips.push({ type: "sa2", label: "SA", value: "SA2" });
    if (sa3) chips.push({ type: "sa3", label: "SA", value: "SA3" });
    if (training !== "all") chips.push({ type: "training", label: "Training", value: training.toUpperCase() });
    if (modelBased !== "all") chips.push({ type: "modelBased", label: "Model", value: modelBased });
    if (scenarios.size > 0) [...scenarios].forEach(sc => chips.push({ type: "scenario", label: "Scenario", value: sc }));

    if (chips.length === 0) { els.chips.innerHTML = ""; return; }

    els.chips.innerHTML = chips.map((c, i) => {
      const key = `${c.type}:${c.value}:${i}`;
      return `
        <span class="chip" data-chip="${escapeHtml(key)}">
          <span class="chip__label">${escapeHtml(c.label)}:</span>
          <span class="chip__value">${escapeHtml(c.value)}</span>
          <button class="chip__x" type="button" aria-label="Remove">×</button>
        </span>
      `;
    }).join("");

    [...els.chips.querySelectorAll(".chip")].forEach((node) => {
      const key = node.getAttribute("data-chip") || "";
      const btn = node.querySelector(".chip__x");
      btn.addEventListener("click", () => {
        const parts = key.split(":");
        const type = parts[0];
        const value = parts.slice(1, -1).join(":");
        removeChip(type, value);
      });
    });
  }

  function removeChip(type, value) {
    if (type === "q") STATE.filters.q = "";
    if (type === "sa1") STATE.filters.sa1 = false;
    if (type === "sa2") STATE.filters.sa2 = false;
    if (type === "sa3") STATE.filters.sa3 = false;
    if (type === "training") STATE.filters.training = "all";
    if (type === "modelBased") STATE.filters.modelBased = "all";
    if (type === "scenario") STATE.filters.scenarios.delete(value);

    syncControlsFromState();
    renderAll();
  }

  function syncControlsFromState() {
    els.q.value = STATE.filters.q;
    els.sa1.checked = STATE.filters.sa1;
    els.sa2.checked = STATE.filters.sa2;
    els.sa3.checked = STATE.filters.sa3;
    els.training.value = STATE.filters.training;
    els.modelBased.value = STATE.filters.modelBased;
    els.sort.value = STATE.filters.sort;

    STATE.scenarios.forEach((sc) => {
      const id = `sc_${paperId({ paper: sc })}`;
      const cb = document.getElementById(id);
      if (cb) cb.checked = STATE.filters.scenarios.has(sc);
    });
  }

  function renderTable() {
    const rows = [];

    STATE.filtered.forEach((p) => {
      const id = paperId(p);
      const open = STATE.expanded.has(id);
      const expSymbol = open ? "−" : "+";

      rows.push(`
        <tr data-id="${escapeHtml(id)}">
          <td class="col-expand">
            <button class="expander" type="button" aria-label="Toggle details">${expSymbol}</button>
          </td>
          <td>${safeCell(p.paper)}</td>
          <td>${safeCell(p.scenario_domain)}</td>
          <td>${safeCell(p.swarm_type)}</td>
          <td>${safeCell(p.human_role)}</td>
          <td>${badgeHtml(p.sa1_rating)}</td>
          <td>${badgeHtml(p.sa2_rating)}</td>
          <td>${badgeHtml(p.sa3_rating)}</td>
          <td>${badgeHtml(trainingYN(p.training_included))}</td>
          <td>${safeCell(p.training_type)}</td>
          <td>${safeCell(p.model_based_support)}</td>
          <td>${safeCell(p.interface_visualization)}</td>
          <td>${safeCell(p.evaluation_metrics_raw)}</td>
          <td>${safeCell(p.key_contribution)}</td>
          <td>${safeCell(p.main_limitation)}</td>
          <td>${safeCell(p.relevance_to_phd)}</td>
        </tr>
      `);

      if (open) {
        const metrics = Array.isArray(p.evaluation_metrics) ? p.evaluation_metrics : [];
        const metricsPills = metrics.length
          ? metrics.map(m => `<span class="pill">${escapeHtml(String(m))}</span>`).join("")
          : `<span class="pill">—</span>`;

        rows.push(`
          <tr class="details-row" data-details="${escapeHtml(id)}">
            <td colspan="16">
              <div class="detail-card">
                <div class="detail-card__box">
                  <h4>Key contribution</h4>
                  <p>${safeCell(p.key_contribution)}</p>
                </div>
                <div class="detail-card__box">
                  <h4>Main limitation</h4>
                  <p>${safeCell(p.main_limitation)}</p>
                </div>
                <div class="detail-card__box">
                  <h4>Evaluation metrics</h4>
                  <p>${safeCell(p.evaluation_metrics_raw)}</p>
                  <div class="detail-card__metrics">${metricsPills}</div>
                </div>
                <div class="detail-card__box">
                  <h4>Interface / visualization</h4>
                  <p>${safeCell(p.interface_visualization)}</p>
                </div>
              </div>
            </td>
          </tr>
        `);
      }
    });

    els.tbody.innerHTML = rows.join("");

    [...els.tbody.querySelectorAll("tr[data-id] .expander")].forEach((btn) => {
      const tr = btn.closest("tr[data-id]");
      const id = tr.getAttribute("data-id");
      btn.addEventListener("click", () => {
        if (STATE.expanded.has(id)) STATE.expanded.delete(id);
        else STATE.expanded.add(id);
        renderAll(false);
      });
    });
  }

  function renderCards() {
    const cards = [];

    STATE.filtered.forEach((p) => {
      const id = paperId(p);
      const open = STATE.expanded.has(id);
      const sym = open ? "−" : "+";

      const metrics = Array.isArray(p.evaluation_metrics) ? p.evaluation_metrics : [];
      const metricsPills = metrics.length
        ? metrics.map(m => `<span class="pill">${escapeHtml(String(m))}</span>`).join("")
        : `<span class="pill">—</span>`;

      cards.push(`
        <article class="paper-card ${open ? "is-open" : ""}" data-card="${escapeHtml(id)}">
          <div class="paper-card__top">
            <div>
              <div class="paper-card__title">${safeCell(p.paper)}</div>
              <div class="paper-card__sub">${safeCell(p.scenario_domain)}</div>
            </div>
            <button class="paper-card__btn" type="button" aria-label="Toggle details">${sym}</button>
          </div>

          <div class="paper-card__grid">
            <div class="kv">
              <div class="kv__k">Swarm Type</div>
              <div class="kv__v">${safeCell(p.swarm_type)}</div>
            </div>
            <div class="kv">
              <div class="kv__k">Human Role</div>
              <div class="kv__v">${safeCell(p.human_role)}</div>
            </div>

            <div class="kv">
              <div class="kv__k">SA</div>
              <div class="kv__badges">
                ${badgeHtml(p.sa1_rating)}
                ${badgeHtml(p.sa2_rating)}
                ${badgeHtml(p.sa3_rating)}
              </div>
            </div>

            <div class="kv">
              <div class="kv__k">Training / Model</div>
              <div class="kv__v">
                Training: ${escapeHtml(trainingYN(p.training_included))}<br/>
                Model: ${safeCell(p.model_based_support)}
              </div>
            </div>

            <div class="kv">
              <div class="kv__k">Training Type</div>
              <div class="kv__v">${safeCell(p.training_type)}</div>
            </div>

            <div class="kv">
              <div class="kv__k">Evaluation</div>
              <div class="kv__v">${safeCell(p.evaluation_metrics_raw)}</div>
            </div>
          </div>

          <div class="paper-card__details">
            <div class="detail-card__box">
              <h4>Key contribution</h4>
              <p>${safeCell(p.key_contribution)}</p>
            </div>
            <div class="detail-card__box">
              <h4>Main limitation</h4>
              <p>${safeCell(p.main_limitation)}</p>
            </div>
            <div class="detail-card__box">
              <h4>Interface / visualization</h4>
              <p>${safeCell(p.interface_visualization)}</p>
            </div>
            <div class="detail-card__box">
              <h4>Evaluation metrics (array)</h4>
              <div class="detail-card__metrics">${metricsPills}</div>
            </div>
            <div class="detail-card__box">
              <h4>Relevance to my PhD</h4>
              <p>${safeCell(p.relevance_to_phd)}</p>
            </div>
          </div>
        </article>
      `);
    });

    els.cards.innerHTML = cards.join("");

    [...els.cards.querySelectorAll(".paper-card__btn")].forEach((btn) => {
      const card = btn.closest(".paper-card");
      const id = card.getAttribute("data-card");
      btn.addEventListener("click", () => {
        if (STATE.expanded.has(id)) STATE.expanded.delete(id);
        else STATE.expanded.add(id);
        renderAll(false);
      });
    });
  }

  function renderAll(keepScroll = true) {
    const wrap = document.querySelector(".table-wrap");
    const prev = wrap ? wrap.scrollLeft : 0;

    applyFilters();
    renderChips();
    renderStatus();
    renderTable();
    renderCards();

    if (keepScroll && wrap) wrap.scrollLeft = prev;
  }

  function clearAllFilters() {
    STATE.filters.q = "";
    STATE.filters.sa1 = false;
    STATE.filters.sa2 = false;
    STATE.filters.sa3 = false;
    STATE.filters.training = "all";
    STATE.filters.modelBased = "all";
    STATE.filters.scenarios = new Set();
    STATE.filters.sort = "year_desc";
    STATE.expanded.clear();
    syncControlsFromState();
    renderAll();
  }

  function csvEscape(v) {
    const s = normStr(v);
    const needs = /[",\n]/.test(s);
    const out = s.replace(/"/g, "\"\"");
    return needs ? `"${out}"` : out;
  }

  function exportFilteredToCsv() {
    const headers = COLS.map(c => c.label);
    const lines = [headers.map(csvEscape).join(",")];

    STATE.filtered.forEach((p) => {
      const row = [];
      row.push(normStr(p.paper));
      row.push(normStr(p.scenario_domain));
      row.push(normStr(p.swarm_type));
      row.push(normStr(p.human_role));
      row.push(normStr(p.sa1_rating));
      row.push(normStr(p.sa2_rating));
      row.push(normStr(p.sa3_rating));
      row.push(trainingYN(p.training_included));
      row.push(normStr(p.training_type));
      row.push(normStr(p.model_based_support));
      row.push(normStr(p.interface_visualization));
      row.push(normStr(p.evaluation_metrics_raw));
      row.push(normStr(p.key_contribution));
      row.push(normStr(p.main_limitation));
      row.push(normStr(p.relevance_to_phd));
      lines.push(row.map(csvEscape).join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "filtered_papers.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function bindControls() {
    els.q.addEventListener("input", () => { STATE.filters.q = els.q.value; renderAll(); });
    els.sa1.addEventListener("change", () => { STATE.filters.sa1 = els.sa1.checked; renderAll(); });
    els.sa2.addEventListener("change", () => { STATE.filters.sa2 = els.sa2.checked; renderAll(); });
    els.sa3.addEventListener("change", () => { STATE.filters.sa3 = els.sa3.checked; renderAll(); });

    els.training.addEventListener("change", () => { STATE.filters.training = els.training.value; renderAll(); });
    els.modelBased.addEventListener("change", () => { STATE.filters.modelBased = els.modelBased.value; renderAll(); });
    els.sort.addEventListener("change", () => { STATE.filters.sort = els.sort.value; renderAll(); });

    els.exportCsv.addEventListener("click", exportFilteredToCsv);
    els.clearAll.addEventListener("click", clearAllFilters);

    els.toggleFilters.addEventListener("click", () => {
      els.filtersPanel.classList.toggle("is-open");
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") els.filtersPanel.classList.remove("is-open");
    });

    document.addEventListener("click", (e) => {
      const isMobile = window.matchMedia("(max-width: 980px)").matches;
      if (!isMobile) return;
      const panel = els.filtersPanel;
      const btn = els.toggleFilters;
      if (!panel.classList.contains("is-open")) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      panel.classList.remove("is-open");
    });
  }

  async function load() {
    bindControls();

    try {
      // ✅ Change here: load CSV exported from Notion
      const res = await fetch("papers.csv", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load papers.csv (${res.status})`);
      const text = await res.text();

      const rows = parseCSV(text);
      const headers = rows[0].map(h => normStr(h));
      const dataRows = rows.slice(1);

      const objects = dataRows.map(r => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = r[i] ?? ""; });
        return obj;
      });

      STATE.all = objects.map(rowFromNotion);

      STATE.scenarios = deriveScenarios(STATE.all);
      buildScenarioList();
      renderAll();
    } catch (err) {
      console.error(err);
      els.status.textContent = "Error loading papers.csv. Use a local server.";
      els.tbody.innerHTML = `
        <tr>
          <td colspan="16" style="padding:14px;">
            <div style="color:#ffb4c0;">
              Failed to load <code>papers.csv</code>.
              Put it in the same folder and run with Live Server / GitHub Pages.
            </div>
          </td>
        </tr>
      `;
      if (els.cards) {
        els.cards.innerHTML = `<div style="color:#ffb4c0;padding:14px;">Failed to load <code>papers.csv</code>.</div>`;
      }
    }
  }

  load();
})();
