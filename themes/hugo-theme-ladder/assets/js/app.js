(() => {
  const panels = Array.from(document.querySelectorAll(".chapter-toc"));
  if (!panels.length) return;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const svgNS = "http://www.w3.org/2000/svg";
  const views = panels.map((panel) => {
    const body = panel.querySelector(".chapter-toc__body");
    const entries = Array.from(body.querySelectorAll("a[href^='#']"))
      .map((link) => {
        const heading = document.getElementById(decodeURIComponent(link.hash.slice(1)));
        return heading ? { link, heading, level: Number(heading.tagName.slice(1)) } : null;
      })
      .filter(Boolean);
    const baseLevel = Math.min(...entries.map((entry) => entry.level));
    entries.forEach((entry) => {
      entry.depth = entry.level - baseLevel;
      entry.link.style.setProperty("--toc-depth", entry.depth);
    });

    const rail = document.createElementNS(svgNS, "svg");
    rail.classList.add("chapter-toc__rail");
    rail.setAttribute("aria-hidden", "true");
    rail.setAttribute("focusable", "false");
    const track = document.createElementNS(svgNS, "path");
    track.classList.add("chapter-toc__track");
    const marker = document.createElementNS(svgNS, "path");
    marker.classList.add("chapter-toc__marker");
    rail.append(track, marker);
    body.prepend(rail);
    return { panel, body, entries, rail, track, marker, ranges: [], total: 0, pointerInside: false, manualUntil: 0 };
  });

  const headings = views[0].entries.map((entry) => entry.heading);
  if (!headings.length) return;
  let activeId = "";
  let pendingId = "";
  let pendingTimer;
  let scrollFrame;
  let layoutFrame;

  const paintMarker = (view) => {
    const index = view.entries.findIndex((entry) => entry.heading.id === activeId);
    const range = view.ranges[index];
    if (!range) return;
    view.marker.style.strokeDasharray = `${range.end - range.start} ${view.total + 1}`;
    view.marker.style.strokeDashoffset = `${-range.start}`;
    view.rail.classList.add("is-ready");
  };

  // The marker shares the rail's path, including its rounded hierarchy bends.
  const drawRail = (view) => {
    if (!view.body.getClientRects().length || !view.entries.length) return;
    const origin = view.body.querySelector("nav").getBoundingClientRect();
    const step = parseFloat(getComputedStyle(document.documentElement).fontSize) * 1.4;
    const rows = view.entries.map(({ link, depth }) => {
      const rect = link.getBoundingClientRect();
      return { x: 1 + depth * step, top: rect.top - origin.top, bottom: rect.bottom - origin.top };
    });
    const width = Math.max(...rows.map((row) => row.x)) + 3;
    const height = rows[rows.length - 1].bottom;
    view.rail.setAttribute("width", width);
    view.rail.setAttribute("height", height);
    view.rail.setAttribute("viewBox", `0 0 ${width} ${height}`);
    let path = `M ${rows[0].x} 2`;
    view.ranges = rows.map((row, index) => {
      const previous = rows[index - 1];
      if (previous && previous.x !== row.x) {
        const boundary = (previous.bottom + row.top) / 2;
        const direction = Math.sign(row.x - previous.x);
        path += ` L ${previous.x} ${boundary - 6}`;
        path += ` Q ${previous.x} ${boundary - 3} ${previous.x + direction * 3} ${boundary - 1}`;
        path += ` L ${row.x - direction * 3} ${boundary + 1}`;
        path += ` Q ${row.x} ${boundary + 3} ${row.x} ${boundary + 6}`;
      }
      path += ` L ${row.x} ${row.top + 8}`;
      view.track.setAttribute("d", path);
      const start = view.track.getTotalLength();
      path += ` L ${row.x} ${row.bottom - 8}`;
      view.track.setAttribute("d", path);
      return { start, end: view.track.getTotalLength() };
    });
    path += ` L ${rows[rows.length - 1].x} ${height - 2}`;
    view.track.setAttribute("d", path);
    view.marker.setAttribute("d", path);
    view.total = view.track.getTotalLength();
    paintMarker(view);
  };

  const revealActiveLink = (view, link) => {
    if (!view.panel.classList.contains("chapter-toc--desktop") || !view.panel.getClientRects().length) return;
    // Let people browse a long outline without the reading position pulling
    // it back underneath the pointer or the currently focused link.
    if (view.pointerInside || view.panel.querySelector(":focus-visible") || performance.now() < view.manualUntil) return;
    const scroller = view.panel.querySelector(".chapter-toc__scroll");
    const bounds = scroller.getBoundingClientRect();
    const rect = link.getBoundingClientRect();
    if (rect.top < bounds.top + 8 || rect.bottom > bounds.bottom - 8) {
      scroller.scrollTo({
        top: scroller.scrollTop + rect.top - bounds.top - bounds.height / 3,
        behavior: reducedMotion.matches ? "instant" : "smooth",
      });
    }
  };

  const setActive = (id) => {
    if (activeId === id) return;
    activeId = id;
    views.forEach((view) => {
      view.entries.forEach(({ link, heading }) => {
        const active = heading.id === id;
        link.classList.toggle("is-active", active);
        if (active) {
          link.setAttribute("aria-current", "location");
          revealActiveLink(view, link);
        } else {
          link.removeAttribute("aria-current");
        }
      });
      paintMarker(view);
    });
  };

  // Resolve in document order so the active section also covers the space
  // between headings and behaves consistently when scrolling upwards.
  const syncFromScroll = () => {
    scrollFrame = null;
    if (pendingId) return;
    const readingLine = Math.min(120, window.innerHeight * 0.2);
    let current = headings[0];
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top > readingLine) break;
      current = heading;
    }
    const content = document.querySelector(".blog-content");
    if (content && content.getBoundingClientRect().bottom <= window.innerHeight) {
      current = headings[headings.length - 1];
    }
    setActive(current.id);
  };

  const queueSync = () => {
    if (!scrollFrame) scrollFrame = requestAnimationFrame(syncFromScroll);
  };
  const releaseNavigation = () => {
    clearTimeout(pendingTimer);
    pendingId = "";
    queueSync();
  };

  views.forEach((view) => {
    const pauseFollowing = () => {
      view.manualUntil = performance.now() + 1000;
      const scroller = view.panel.querySelector(".chapter-toc__scroll");
      if (scroller) scroller.scrollTo({ top: scroller.scrollTop, behavior: "instant" });
    };
    view.panel.addEventListener("pointerenter", () => {
      view.pointerInside = true;
      pauseFollowing();
    });
    view.panel.addEventListener("pointerleave", () => { view.pointerInside = false; });
    view.panel.addEventListener("focusin", pauseFollowing);
    view.panel.addEventListener("wheel", pauseFollowing, { passive: true });
    view.panel.addEventListener("touchstart", pauseFollowing, { passive: true });
    view.entries.forEach(({ link, heading }) => {
      link.addEventListener("click", (event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        clearTimeout(pendingTimer);
        pendingId = heading.id;
        setActive(heading.id);
        history.pushState(null, "", link.hash);
        heading.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
        pendingTimer = setTimeout(releaseNavigation, 1600);
      });
    });
    view.panel.addEventListener("toggle", () => {
      drawRail(view);
      queueSync();
    });
  });

  const refreshLayout = () => {
    cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      views.forEach(drawRail);
      queueSync();
    });
  };
  const resizeObserver = new ResizeObserver(refreshLayout);
  views.forEach((view) => resizeObserver.observe(view.body.querySelector("nav")));
  document.addEventListener("scroll", queueSync, { passive: true });
  document.addEventListener("scrollend", (event) => {
    // Scroll-end events from the outline must not unlock the still-moving
    // article and briefly highlight every intervening heading.
    if (event.target === document) releaseNavigation();
  });
  const interruptNavigation = (event) => {
    if (!event.target.closest?.(".chapter-toc")) releaseNavigation();
  };
  window.addEventListener("wheel", interruptNavigation, { passive: true });
  window.addEventListener("touchstart", interruptNavigation, { passive: true });
  window.addEventListener("keydown", (event) => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) releaseNavigation();
  });
  window.addEventListener("resize", refreshLayout);
  window.addEventListener("hashchange", releaseNavigation);
  window.addEventListener("popstate", releaseNavigation);
  window.addEventListener("load", refreshLayout, { once: true });
  document.fonts.ready.then(refreshLayout);
  refreshLayout();
})();
