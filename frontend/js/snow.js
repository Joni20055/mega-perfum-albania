(function () {
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const host = document.querySelector(".snow");
  if (!host || motion) return;

  const canvas = document.createElement("canvas");
  host.replaceChildren(canvas);
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let flakes = [];
  let running = true;

  function make(anywhere) {
    const large = Math.random() < 0.16;
    return {
      x: Math.random() * width,
      y: anywhere ? Math.random() * height : -8,
      r: large ? 2.4 + Math.random() * 2.1 : 0.9 + Math.random() * 1.3,
      speed: 0.28 + Math.random() * (large ? 0.55 : 1.15),
      drift: (Math.random() - 0.5) * 0.28,
      sway: Math.random() * Math.PI * 2,
      gold: Math.random() < 0.2,
      alpha: 0.42 + Math.random() * 0.36,
    };
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const total = width < 760 ? 24 : 52;
    while (flakes.length < total) flakes.push(make(true));
    flakes.length = total;
  }

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, width, height);
    flakes.forEach((flake) => {
      flake.sway += 0.008;
      flake.x += flake.drift + Math.sin(flake.sway) * 0.32;
      flake.y += flake.speed;
      if (flake.y > height + 6 || flake.x < -12 || flake.x > width + 12) {
        const next = make(false);
        flake.x = next.x;
        flake.y = -8;
        flake.r = next.r;
        flake.speed = next.speed;
        flake.drift = next.drift;
        flake.gold = next.gold;
        flake.alpha = next.alpha;
      }
      ctx.beginPath();
      ctx.fillStyle = flake.gold
        ? "rgba(197, 161, 91, " + flake.alpha + ")"
        : "rgba(255, 255, 255, " + flake.alpha + ")";
      ctx.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(frame);
  }

  document.addEventListener("visibilitychange", () => {
    const was = running;
    running = !document.hidden;
    if (running && !was) requestAnimationFrame(frame);
  });
  window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frame);

  const burstHost = document.createElement("canvas");
  burstHost.className = "fest-burst";
  burstHost.setAttribute("aria-hidden", "true");
  document.body.appendChild(burstHost);
  const burstCtx = burstHost.getContext("2d");
  let bits = [];
  let bursting = false;

  function burst(origin) {
    const box = origin && origin.getBoundingClientRect ? origin.getBoundingClientRect() : null;
    const x = box ? box.left + box.width / 2 : window.innerWidth / 2;
    const y = box ? box.top + 8 : window.innerHeight * 0.35;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    burstHost.width = Math.floor(window.innerWidth * dpr);
    burstHost.height = Math.floor(window.innerHeight * dpr);
    burstHost.style.width = window.innerWidth + "px";
    burstHost.style.height = window.innerHeight + "px";
    burstCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bits = Array.from({ length: width < 760 ? 10 : 16 }, () => ({
      x,
      y,
      vx: (Math.random() - 0.5) * 2.4,
      vy: -1.2 - Math.random() * 1.8,
      r: 1.2 + Math.random() * 1.8,
      gold: Math.random() < 0.55,
      life: 1,
    }));
    if (!bursting) {
      bursting = true;
      requestAnimationFrame(drawBurst);
    }
  }

  function drawBurst() {
    burstCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    bits.forEach((bit) => {
      bit.x += bit.vx;
      bit.y += bit.vy;
      bit.vy += 0.045;
      bit.life -= 0.02;
      if (bit.life <= 0) return;
      burstCtx.beginPath();
      burstCtx.fillStyle = bit.gold
        ? "rgba(197, 161, 91, " + bit.life + ")"
        : "rgba(255, 255, 255, " + bit.life + ")";
      burstCtx.arc(bit.x, bit.y, bit.r, 0, Math.PI * 2);
      burstCtx.fill();
    });
    if (bits.some((bit) => bit.life > 0)) requestAnimationFrame(drawBurst);
    else {
      bursting = false;
      burstCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  window.megaFest = { burst };
})();
