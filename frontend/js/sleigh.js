(function () {
  const box = document.querySelector(".sleigh");
  if (!box || !window.lottie) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  window.lottie.loadAnimation({
    container: box,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: "/animations/sleigh.json",
  });
})();
