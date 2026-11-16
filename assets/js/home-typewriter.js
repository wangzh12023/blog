// Typed.js drives the one-time reveal; the complete headline reserves its space.
(() => {
  const heading = document.querySelector(".home-title");
  const target = heading?.querySelector("[data-home-typewriter]");
  if (!heading || !target || typeof window.Typed !== "function") return;

  const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (motion.matches) return;

  const text = heading.getAttribute("aria-label");
  heading.classList.add("is-typing");

  const typed = new window.Typed(target, {
    strings: [text],
    contentType: "text",
    startDelay: 280,
    typeSpeed: 68,
    loop: false,
    showCursor: false,
    autoInsertCss: false,
    onComplete() {
      heading.classList.add("is-complete");
    },
  });

  // Changing the system setting during the reveal immediately shows the title.
  motion.addEventListener("change", (event) => {
    if (!event.matches) return;
    typed.destroy();
    heading.classList.remove("is-typing", "is-complete");
  }, { once: true });
})();
