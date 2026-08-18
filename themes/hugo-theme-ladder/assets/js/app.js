const chapterTocLinks = Array.from(
  document.querySelectorAll(".chapter-toc--desktop a[href^='#']")
);

if (chapterTocLinks.length > 0) {
  const headings = chapterTocLinks
    .map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))))
    .filter(Boolean);

  const setActiveChapter = (id) => {
    chapterTocLinks.forEach((link) => {
      link.classList.toggle("is-active", link.hash === `#${id}`);
    });
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleHeading = entries.find((entry) => entry.isIntersecting);
      if (visibleHeading) {
        setActiveChapter(visibleHeading.target.id);
      }
    },
    { rootMargin: "-15% 0px -70% 0px" }
  );

  headings.forEach((heading) => observer.observe(heading));
  if (headings[0]) {
    setActiveChapter(headings[0].id);
  }
}
