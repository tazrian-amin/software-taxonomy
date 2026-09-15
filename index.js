/* The Software Tree — renders one taxonomy JSON file as an expandable tree.
   Which file, and which page it belongs to, come from #tree's data attributes,
   so index.html, web-apps.html, and mobile-apps.html all share this script. */
(() => {
  "use strict";

  const stage = document.getElementById("tree");
  const SCOPE = stage.dataset.scope || "home";
  const SOURCE = stage.dataset.source || "data.json";

  // Theme and rail follow the reader across the site; which branches are open,
  // and which view they left behind, belong to one page each.
  const STORE_OPEN = `software-tree:${SCOPE}:open`;
  const STORE_THEME = "software-tree:theme";
  const STORE_VIEW = `software-tree:${SCOPE}:view`;
  const STORE_RAIL = "software-tree:rail";

  const els = {
    branches: document.getElementById("branches"),
    rail: document.getElementById("rail"),
    railPanel: document.querySelector(".rail"),
    rootName: document.getElementById("root-name"),
    rootDesc: document.getElementById("root-desc"),
    search: document.getElementById("search"),
    clear: document.getElementById("search-clear"),
    expandAll: document.getElementById("expand-all"),
    collapseAll: document.getElementById("collapse-all"),
    status: document.getElementById("status"),
    empty: document.getElementById("empty"),
    tally: document.getElementById("tally"),
    themeToggle: document.getElementById("theme-toggle"),
    toolbar: document.querySelector(".toolbar"),
    overview: document.getElementById("map-view"),
    chart: document.getElementById("chart-view"),
    controls: document.querySelector(".controls"),
    viewButtons: Array.from(document.querySelectorAll("[data-view]")),
    layout: document.querySelector(".layout"),
    railToggle: document.getElementById("rail-toggle"),
  };

  /** Branch records, in document order: DOM handles plus searchable text. */
  const branches = [];
  let treeData = null;
  let query = "";
  let view = "explore";
  let savedOpen = null; // open-state snapshot taken when a search begins

  /* ------------------------------------------------------------ storage */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* private mode or blocked storage — the tree still works */
      }
    },
  };

  /* -------------------------------------------------------------- theme */

  function systemTheme() {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const next = theme === "dark" ? "Light" : "Dark";
    els.themeToggle.querySelector(".theme-toggle__label").textContent = next;
    els.themeToggle.setAttribute("aria-pressed", String(theme === "dark"));
    els.themeToggle.setAttribute(
      "aria-label",
      `Switch to ${next.toLowerCase()} theme`,
    );
  }

  function initTheme() {
    applyTheme(store.get(STORE_THEME, null) || systemTheme());
    els.themeToggle.addEventListener("click", () => {
      const next =
        document.documentElement.getAttribute("data-theme") === "dark"
          ? "light"
          : "dark";
      applyTheme(next);
      store.set(STORE_THEME, next);
    });
  }

  /* --------------------------------------------------------------- rail */

  const wideScreen = window.matchMedia("(min-width: 861px)");

  function setRail(collapsed) {
    els.layout.dataset.rail = collapsed ? "collapsed" : "expanded";
    els.railToggle.setAttribute("aria-expanded", String(!collapsed));
    els.railToggle.setAttribute(
      "aria-label",
      collapsed ? "Show the branch list" : "Hide the branch list",
    );
  }

  function initRail() {
    const saved = store.get(STORE_RAIL, null);
    // Wide screens open the list; phones and tablets start it out of the way.
    setRail(saved === null ? !wideScreen.matches : saved === "collapsed");

    els.railToggle.addEventListener("click", () => {
      const collapsed = els.layout.dataset.rail !== "collapsed";
      setRail(collapsed);
      store.set(STORE_RAIL, collapsed ? "collapsed" : "expanded");
    });

    // Until the reader picks a side, follow the screen across the breakpoint.
    wideScreen.addEventListener("change", (event) => {
      if (store.get(STORE_RAIL, null) === null) setRail(!event.matches);
    });
  }

  /* ------------------------------------------------------------ helpers */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  /** Writes text into an element, wrapping every hit on `q` in <mark>. */
  function paint(node, text, q) {
    node.textContent = "";
    if (!q) {
      node.textContent = text;
      return;
    }
    const haystack = text.toLowerCase();
    let from = 0;
    let at;
    while ((at = haystack.indexOf(q, from)) !== -1) {
      if (at > from) node.append(text.slice(from, at));
      const hit = el("mark", null, text.slice(at, at + q.length));
      node.append(hit);
      from = at + q.length;
    }
    node.append(text.slice(from));
  }

  const PLURALS = {
    branch: "branches",
    subcategory: "subcategories",
    example: "examples",
  };
  const plural = (n, word) =>
    `${n} ${n === 1 ? word : PLURALS[word] || `${word}s`}`;

  /* ---------------------------------------------------------- open state */

  function setOpen(record, open) {
    record.el.classList.toggle("is-open", open);
    record.head.setAttribute("aria-expanded", String(open));
    record.open = open;
  }

  function currentOpenKeys() {
    const keys = [];
    branches.forEach((branch) => {
      if (branch.open) keys.push(branch.key);
      branch.subs.forEach((sub) => {
        if (sub.open) keys.push(sub.key);
      });
    });
    return keys;
  }

  function persistOpen() {
    if (query) return; // a search forces nodes open; don't save that
    store.set(STORE_OPEN, currentOpenKeys());
  }

  function restoreOpen(keys) {
    const set = new Set(keys);
    branches.forEach((branch) => {
      setOpen(branch, set.has(branch.key));
      branch.subs.forEach((sub) => setOpen(sub, set.has(sub.key)));
    });
  }

  function setAll(open) {
    branches.forEach((branch) => {
      if (branch.el.classList.contains("is-hidden")) return;
      setOpen(branch, open);
      branch.subs.forEach((sub) => setOpen(sub, open));
    });
    persistOpen();
    if (view === "chart") renderChart(query);
  }

  /* --------------------------------------------------------------- build */

  function buildSub(sub, branchId, index) {
    const item = el("li", "sub");
    const panelId = `${branchId}-${index}-panel`;

    const head = el("button", "sub__head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    head.setAttribute("aria-controls", panelId);
    head.append(el("span", "twist"));
    const name = el("span", "sub__name");
    head.append(name);
    head.append(
      el("span", "sub__count", plural(sub.examples.length, "example")),
    );

    const panel = el("div", "sub__panel");
    panel.id = panelId;
    const inner = el("div", "sub__inner");
    const desc = el("p", "sub__desc");
    if (!sub.description) desc.hidden = true;
    inner.append(desc);
    const chips = el("ul", "chips");
    const chipEls = sub.examples.map((example) => {
      const chip = el("li", "chip");
      chips.append(chip);
      return chip;
    });
    inner.append(chips);
    panel.append(inner);
    item.append(head, panel);

    const record = {
      key: `${branchId}/${index}`,
      data: sub,
      el: item,
      head,
      name,
      desc,
      chipEls,
      open: false,
      text: `${sub.name} ${sub.description || ""} ${sub.examples.join(" ")}`
        .toLowerCase(),
    };

    head.addEventListener("click", () => {
      setOpen(record, !record.open);
      persistOpen();
      markActive(branchId);
    });

    return record;
  }

  function buildBranch(category) {
    const section = el("section", "branch");
    section.id = category.id;
    section.dataset.branch = category.id;
    const panelId = `${category.id}-panel`;

    const head = el("button", "branch__head");
    head.type = "button";
    head.setAttribute("aria-expanded", "false");
    head.setAttribute("aria-controls", panelId);
    head.append(el("span", "twist"));
    const name = el("span", "branch__name");
    head.append(name);
    head.append(
      el(
        "span",
        "branch__count",
        plural(category.subcategories.length, "subcategory"),
      ),
    );

    const desc = el("p", "branch__desc");

    const panel = el("div", "branch__panel");
    panel.id = panelId;
    const inner = el("div", "branch__inner");
    const list = el("ul", "subs");
    inner.append(list);
    panel.append(inner);
    section.append(head, desc, panel);

    const subs = category.subcategories.map((sub, i) => {
      const record = buildSub(sub, category.id, i);
      list.append(record.el);
      return record;
    });

    const record = {
      key: category.id,
      data: category,
      el: section,
      head,
      name,
      desc,
      subs,
      open: false,
      text: `${category.name} ${category.description}`.toLowerCase(),
    };

    head.addEventListener("click", () => {
      setOpen(record, !record.open);
      persistOpen();
      markActive(category.id);
      if (record.open) history.replaceState(null, "", `#${category.id}`);
    });

    return record;
  }

  function buildRail() {
    branches.forEach((branch) => {
      const link = el("button", "rail__link");
      link.type = "button";
      link.dataset.target = branch.key;
      link.append(el("span", "rail__name", branch.data.name));
      link.addEventListener("click", () => {
        revealBranch(branch, true);
        if (!wideScreen.matches) setRail(true);
      });
      els.rail.append(link);
      branch.railLink = link;
    });
  }

  function revealBranch(branch, focusHead) {
    markActive(branch.data.id);

    // In the chart, unfolding the branch is what "take me there" means.
    if (view === "chart") {
      if (!branch.open) {
        setOpen(branch, true);
        persistOpen();
        renderChart(query);
      }
      const node = document.getElementById(`chart-${branch.data.id}`);
      if (node) scrollToAnchor(node);
      return;
    }

    if (view === "overview") {
      const block = document.getElementById(`map-${branch.data.id}`);
      if (block) scrollToAnchor(block);
      return;
    }

    // Only Explore owns the branch hash; #chart and #overview stay put.
    history.replaceState(null, "", `#${branch.data.id}`);
    setOpen(branch, true);
    persistOpen();
    scrollToAnchor(branch.el);
    if (focusHead) branch.head.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ overview */

  /** Redraws the whole-taxonomy map, filtered and highlighted by `q`. */
  function renderOverview(q) {
    if (!treeData) return;
    els.overview.textContent = "";

    const hint = el("p", "overview__hint");
    hint.append(
      q
        ? "Branches matching your search. "
        : "The whole taxonomy at a glance. ",
    );
    hint.append("Select any branch to open it in Explore.");
    els.overview.append(hint);

    const grid = el("div", "overview__grid");

    treeData.categories.forEach((category) => {
      const haystack = `${category.name} ${category.description}`.toLowerCase();
      const branchHit = q ? haystack.includes(q) : false;
      const subs = category.subcategories.filter(
        (sub) =>
          !q ||
          branchHit ||
          `${sub.name} ${sub.examples.join(" ")}`.toLowerCase().includes(q),
      );
      if (q && !branchHit && subs.length === 0) return;

      const block = el("section", "ov-branch");
      block.id = `map-${category.id}`;
      block.dataset.branch = category.id;

      const head = el("button", "ov-branch__head");
      head.type = "button";
      head.title = category.description;
      head.append(el("span", "ov-branch__code", category.id));
      const name = el("span", "ov-branch__name");
      paint(name, category.name, q);
      head.append(name);
      head.addEventListener("click", () => {
        const record = branches.find((b) => b.data.id === category.id);
        if (!record) return;
        setView("explore");
        revealBranch(record, true);
      });

      const list = el("ul", "ov-subs");
      subs.forEach((sub) => {
        const item = el("li", "ov-sub");
        item.title = sub.examples.join(", ");
        const label = el("span", "ov-sub__name");
        paint(label, sub.name, q);
        item.append(label);
        item.append(el("span", "ov-sub__count", String(sub.examples.length)));
        list.append(item);
      });

      block.append(head, list);
      grid.append(block);
    });

    els.overview.append(grid);
  }

  /* --------------------------------------------------------------- chart */

  const SVG_NS = "http://www.w3.org/2000/svg";
  const CHART = {
    pad: 16,
    colGap: 56,
    subRow: 25,
    branchRow: 36,
    groupGap: 16,
    pillH: 26,
  };
  const FONT_PILL = '600 14px "IBM Plex Serif", Georgia, serif';
  const FONT_COUNT = '10.5px "IBM Plex Mono", monospace';
  const FONT_LEAF = '13px "IBM Plex Sans", system-ui, sans-serif';

  let measurer = null;

  /** Real text widths, so columns never overlap the labels beside them. */
  function textWidth(text, font) {
    if (!measurer) measurer = document.createElement("canvas").getContext("2d");
    measurer.font = font;
    return measurer.measureText(text).width;
  }

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs || {}).forEach(([key, value]) =>
      node.setAttribute(key, value),
    );
    if (text != null) node.textContent = text;
    return node;
  }

  /** A cubic curve between two points in neighbouring columns. */
  function chartLink(x1, y1, x2, y2) {
    const dx = (x2 - x1) * 0.5;
    return svgEl("path", {
      class: "chart__link",
      d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`,
    });
  }

  function renderChart(q) {
    if (!treeData) return;
    els.chart.textContent = "";

    const hint = el(
      "p",
      "chart__hint",
      q
        ? "Branches matching your search."
        : "Categories and subcategories only. Select a branch to fold or unfold it.",
    );
    els.chart.append(hint);

    // Which branches and subcategories belong on the diagram.
    const model = [];
    treeData.categories.forEach((category) => {
      const record = branches.find((b) => b.data.id === category.id);
      const branchHit = q
        ? `${category.name} ${category.description}`.toLowerCase().includes(q)
        : false;
      const matching = category.subcategories.filter((sub) =>
        q
          ? `${sub.name} ${sub.examples.join(" ")}`.toLowerCase().includes(q)
          : true,
      );
      if (q && !branchHit && matching.length === 0) return;

      const subs = q
        ? branchHit
          ? category.subcategories
          : matching
        : record && record.open
          ? category.subcategories
          : [];

      model.push({
        category,
        record,
        subs,
        hit: branchHit,
        hits: new Set(matching.map((sub) => sub.name)),
        expanded: subs.length > 0,
      });
    });

    if (!model.length) return;

    // Column geometry, measured rather than guessed.
    const rootW = Math.ceil(textWidth(treeData.name, FONT_PILL)) + 34;
    let pillW = 0;
    model.forEach((item) => {
      item.pillW =
        26 +
        Math.ceil(textWidth(item.category.name, FONT_PILL)) +
        14 +
        Math.ceil(
          textWidth(String(item.category.subcategories.length), FONT_COUNT),
        ) +
        14;
      pillW = Math.max(pillW, item.pillW);
    });
    let leafW = 0;
    model.forEach((item) =>
      item.subs.forEach((sub) => {
        leafW = Math.max(leafW, Math.ceil(textWidth(sub.name, FONT_LEAF)));
      }),
    );

    const rootX = CHART.pad;
    const trunkX = rootX + 18;
    const branchX = trunkX + 42;
    const subX = branchX + pillW + CHART.colGap;
    const rootY = CHART.pad + 16;
    const width = Math.max(subX + 13 + leafW, rootX + rootW) + CHART.pad;

    // Leaves stack; each branch sits level with the middle of its own leaves.
    let y = rootY + 42;
    model.forEach((item) => {
      if (item.subs.length) {
        const top = y;
        item.subYs = item.subs.map(
          (_, i) => top + i * CHART.subRow + CHART.subRow / 2,
        );
        item.y = (item.subYs[0] + item.subYs[item.subYs.length - 1]) / 2;
        y = top + item.subs.length * CHART.subRow;
      } else {
        item.subYs = [];
        item.y = y + CHART.branchRow / 2;
        y += CHART.branchRow;
      }
      y += CHART.groupGap;
    });
    const height = y - CHART.groupGap + CHART.pad + 10;

    const svg = svgEl("svg", {
      class: "chart__svg",
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: "group",
      "aria-label": "Tree diagram of the software taxonomy",
    });
    const links = svgEl("g", {});
    const nodes = svgEl("g", {});

    // one trunk down from the root, with a rounded elbow out to each branch
    const lastY = model[model.length - 1].y;
    links.append(
      svgEl("path", {
        class: "chart__link",
        d: `M${trunkX},${rootY + 16} L${trunkX},${lastY}`,
      }),
    );
    model.forEach((item) => {
      links.append(
        svgEl("path", {
          class: "chart__link",
          d: `M${trunkX},${item.y - 14} Q${trunkX},${item.y} ${trunkX + 14},${
            item.y
          } L${branchX},${item.y}`,
        }),
      );
      item.subYs.forEach((subY) =>
        links.append(chartLink(branchX + item.pillW, item.y, subX - 4, subY)),
      );
    });

    const root = svgEl("g", { class: "chart__root" });
    root.append(
      svgEl("rect", {
        class: "chart__pill",
        x: rootX,
        y: rootY - 15,
        width: rootW,
        height: 30,
        rx: 15,
      }),
    );
    root.append(
      svgEl(
        "text",
        { class: "chart__pill-label", x: rootX + 17, y: rootY + 5 },
        treeData.name,
      ),
    );
    nodes.append(root);

    model.forEach((item) => {
      const group = svgEl("g", {
        class: `chart__node${item.hit ? " chart__node--hit" : ""}`,
        id: `chart-${item.category.id}`,
        role: "button",
        tabindex: "0",
        "aria-expanded": String(item.expanded),
        "aria-label": `${item.category.name}, ${plural(
          item.category.subcategories.length,
          "subcategory",
        )}`,
      });
      group.dataset.branch = item.category.id;
      group.append(svgEl("title", {}, item.category.description));
      group.append(
        svgEl("rect", {
          class: "chart__pill",
          x: branchX,
          y: item.y - CHART.pillH / 2,
          width: item.pillW,
          height: CHART.pillH,
          rx: 6,
        }),
      );

      // the plus that loses its stem when the branch is unfolded
      const gx = branchX + 13;
      group.append(
        svgEl("line", {
          class: "chart__glyph",
          x1: gx - 4,
          y1: item.y,
          x2: gx + 4,
          y2: item.y,
        }),
      );
      if (!item.expanded) {
        group.append(
          svgEl("line", {
            class: "chart__glyph",
            x1: gx,
            y1: item.y - 4,
            x2: gx,
            y2: item.y + 4,
          }),
        );
      }

      group.append(
        svgEl(
          "text",
          { class: "chart__pill-label", x: branchX + 26, y: item.y + 5 },
          item.category.name,
        ),
      );
      group.append(
        svgEl(
          "text",
          {
            class: "chart__pill-count",
            x: branchX + item.pillW - 12,
            y: item.y + 4,
            "text-anchor": "end",
          },
          String(item.category.subcategories.length),
        ),
      );

      const toggle = () => {
        if (!item.record) return;
        setOpen(item.record, !item.record.open);
        persistOpen();
        markActive(item.category.id);
        renderChart(query);
      };
      group.addEventListener("click", toggle);
      group.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggle();
        }
      });
      nodes.append(group);

      item.subs.forEach((sub, i) => {
        const isHit = q ? item.hits.has(sub.name) : false;
        const leaf = svgEl("g", {
          class: `chart__leaf${isHit ? " chart__leaf--hit" : ""}`,
        });
        leaf.append(
          svgEl("circle", {
            class: "chart__leaf-dot",
            cx: subX,
            cy: item.subYs[i],
            r: 2.5,
          }),
        );
        leaf.append(
          svgEl(
            "text",
            { class: "chart__leaf-label", x: subX + 12, y: item.subYs[i] + 4 },
            sub.name,
          ),
        );
        nodes.append(leaf);
      });
    });

    svg.append(links, nodes);
    const canvas = el("div", "chart__canvas");
    canvas.append(svg);
    els.chart.append(canvas);
  }

  function setView(next) {
    view = next;
    const isOverview = next === "overview";
    const isChart = next === "chart";

    els.branches.hidden = isOverview || isChart;
    els.overview.hidden = !isOverview;
    els.chart.hidden = !isChart;
    els.controls.hidden = isOverview; // nothing to expand on the map
    els.viewButtons.forEach((btn) =>
      btn.setAttribute("aria-pressed", String(btn.dataset.view === next)),
    );
    store.set(STORE_VIEW, next);

    if (isOverview || isChart) {
      history.replaceState(null, "", isChart ? "#chart" : "#overview");
      if (isChart) renderChart(query);
      else renderOverview(query);
    } else {
      if (location.hash === "#overview" || location.hash === "#chart") {
        history.replaceState(null, "", location.pathname + location.search);
      }
      }
  }

  /* -------------------------------------------------------------- search */

  function runSearch(raw) {
    const q = raw.trim().toLowerCase();
    const starting = !query && q;
    const ending = query && !q;

    if (starting) savedOpen = currentOpenKeys();
    query = q;
    els.clear.hidden = !q;

    let hitBranches = 0;
    let hitSubs = 0;
    let hitExamples = 0;

    branches.forEach((branch) => {
      const branchHit = q ? branch.text.includes(q) : false;
      let subHits = 0;

      branch.subs.forEach((sub) => {
        const subHit = q ? sub.text.includes(q) : false;
        const show = !q || branchHit || subHit;
        sub.el.classList.toggle("is-hidden", !show);

        paint(sub.name, sub.data.name, q);
        paint(sub.desc, sub.data.description || "", q);
        sub.chipEls.forEach((chip, i) => paint(chip, sub.data.examples[i], q));

        if (subHit) {
          subHits += 1;
          hitSubs += 1;
          hitExamples += sub.data.examples.filter((e) =>
            e.toLowerCase().includes(q),
          ).length;
          setOpen(sub, true);
        } else if (q) {
          setOpen(sub, false);
        }
      });

      const show = !q || branchHit || subHits > 0;
      branch.el.classList.toggle("is-hidden", !show);
      paint(branch.name, branch.data.name, q);
      paint(branch.desc, branch.data.description, q);
      if (branch.railLink) branch.railLink.hidden = !show;

      if (q && show) {
        hitBranches += 1;
        setOpen(branch, true);
      }
    });

    if (ending) {
      restoreOpen(savedOpen || []);
      savedOpen = null;
    }

    els.empty.hidden = !(q && hitBranches === 0);
    if (view === "overview") renderOverview(q);
    else if (view === "chart") renderChart(q);

    if (!q) {
      els.status.textContent = "";
    } else if (hitBranches === 0) {
      els.status.textContent = `No matches for "${raw.trim()}"`;
    } else {
      const parts = [plural(hitBranches, "branch")];
      if (hitSubs) parts.push(plural(hitSubs, "subcategory"));
      if (hitExamples) parts.push(plural(hitExamples, "example"));
      els.status.textContent = `${parts.join(" · ")} matching "${raw.trim()}"`;
    }
    measureToolbar();
  }

  /* --------------------------------------------------------- active item */

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /** Where a selected branch is parked: just below the sticky toolbar. */
  function scrollLine() {
    return (els.toolbar ? els.toolbar.getBoundingClientRect().height : 0) + 28;
  }

  /** Scrolls the rail's own box, never the page, to keep a link visible. */
  function keepRailLinkInView(link) {
    const box = link.getBoundingClientRect();
    const column = els.railPanel;
    const strip = els.rail;

    if (column && column.scrollHeight > column.clientHeight + 1) {
      const frame = column.getBoundingClientRect();
      if (box.top < frame.top) column.scrollTop -= frame.top - box.top + 8;
      else if (box.bottom > frame.bottom) {
        column.scrollTop += box.bottom - frame.bottom + 8;
      }
    }
    if (strip && strip.scrollWidth > strip.clientWidth + 1) {
      const frame = strip.getBoundingClientRect();
      if (box.left < frame.left) strip.scrollLeft -= frame.left - box.left + 8;
      else if (box.right > frame.right) {
        strip.scrollLeft += box.right - frame.right + 8;
      }
    }
  }

  let activeBranchId;

  function markActive(id) {
    if (id === activeBranchId) return;
    activeBranchId = id;

    let active = null;
    branches.forEach((branch) => {
      if (!branch.railLink) return;
      if (branch.data.id === id) {
        branch.railLink.setAttribute("aria-current", "true");
        active = branch.railLink;
      } else {
        branch.railLink.removeAttribute("aria-current");
      }
    });
    if (active) keepRailLinkInView(active);
  }

  /** Parks any element — section or SVG node — just under the toolbar. */
  function scrollToAnchor(node) {
    const top = window.scrollY + node.getBoundingClientRect().top - scrollLine();
    window.scrollTo({
      top: Math.max(top, 0),
      behavior: reduceMotion.matches ? "auto" : "smooth",
    });
  }

  function measureToolbar() {
    if (!els.toolbar) return;
    const h = Math.round(els.toolbar.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--toolbar-h", `${h}px`);
  }

  /* ------------------------------------------------------------- wire up */

  function initShortcuts() {
    document.addEventListener("keydown", (event) => {
      const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        els.search.focus();
        els.search.select();
      } else if (event.key === "Escape" && typing) {
        els.search.value = "";
        runSearch("");
        els.search.blur();
      }
    });
  }

  function render(tree) {
    treeData = tree;
    els.rootName.textContent = tree.name;
    els.rootDesc.textContent = tree.description;

    tree.categories.forEach((category) => {
      const record = buildBranch(category);
      branches.push(record);
      els.branches.append(record.el);
    });

    buildRail();
    runSearch(""); // paints every label and chip in its unhighlighted state

    const subCount = branches.reduce((n, b) => n + b.subs.length, 0);
    const exampleCount = branches.reduce(
      (n, b) => n + b.subs.reduce((m, s) => m + s.data.examples.length, 0),
      0,
    );
    els.tally.querySelector('[data-stat="categories"]').textContent =
      branches.length;
    els.tally.querySelector('[data-stat="subcategories"]').textContent =
      subCount;
    els.tally.querySelector('[data-stat="examples"]').textContent =
      exampleCount;

    // Open the first branch so the page shows what a branch looks like.
    const stored = store.get(STORE_OPEN, null);
    if (stored && stored.length) {
      restoreOpen(stored);
    } else if (branches.length) {
      setOpen(branches[0], true);
      if (branches[0].subs.length) setOpen(branches[0].subs[0], true);
    }

    const hash = decodeURIComponent(location.hash.slice(1));
    const target = branches.find((b) => b.data.id === hash);
    if (target) {
      setOpen(target, true);
      markActive(target.data.id);
      requestAnimationFrame(() => target.el.scrollIntoView({ block: "start" }));
    }

    els.search.addEventListener("input", (event) =>
      runSearch(event.target.value),
    );
    els.clear.addEventListener("click", () => {
      els.search.value = "";
      runSearch("");
      els.search.focus();
    });
    els.expandAll.addEventListener("click", () => setAll(true));
    els.collapseAll.addEventListener("click", () => setAll(false));

    els.viewButtons.forEach((btn) =>
      btn.addEventListener("click", () => setView(btn.dataset.view)),
    );

    // A branch deep link always lands in Explore; #overview opens the map.
    const saved = store.get(STORE_VIEW, "explore");
    const storedView =
      saved === "overview" || saved === "chart" ? saved : "explore";
    const fromHash = hash === "overview" || hash === "chart" ? hash : null;
    setView(target ? "explore" : fromHash || storedView);

    // Web fonts change text metrics, so redraw the measured diagram once.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        if (view === "chart") renderChart(query);
      });
    }
    measureToolbar();
    window.addEventListener("resize", measureToolbar);
  }

  function fail(message) {
    els.branches.innerHTML = "";
    const box = el("p", "empty");
    box.append(message);
    els.branches.append(box);
  }

  function start() {
    initTheme();
    initRail();
    initShortcuts();

    if (window.SOFTWARE_TREE) {
      render(window.SOFTWARE_TREE);
      return;
    }

    fetch(SOURCE)
      .then((response) => {
        if (!response.ok)
          throw new Error(`${SOURCE} returned ${response.status}`);
        return response.json();
      })
      .then(render)
      .catch(() => {
        fail(
          location.protocol === "file:"
            ? `Browsers block reading ${SOURCE} straight from disk. Serve the folder instead — run \`python3 -m http.server\` here, then open http://localhost:8000.`
            : `${SOURCE} could not be loaded. Check that it sits beside the page and contains valid JSON.`,
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
