export const themes = {
  city: {
    ground: "#b7c3a5",
    grid: "#a8b499",
    road: "#d1d5c8",
    accent: "#627b51",
  },
  forest: {
    ground: "#274a3b",
    grid: "#315543",
    road: "#2c5040",
    accent: "#8dcca1",
  },
  space: {
    ground: "#222038",
    grid: "#302b49",
    road: "#27233d",
    accent: "#a99acb",
  },
};

export function drawGround(ctx, map, width, height) {
  const t = themes[map];
  ctx.fillStyle = t.ground;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = t.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < width; x += 100) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y < height; y += 100) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  if (map === "city") {
    ctx.fillStyle = t.road;
    for (const x of [420, 900, 1380]) ctx.fillRect(x - 27, 0, 54, height);
    for (const y of [200, 600, 1000]) ctx.fillRect(0, y - 27, width, 54);
    ctx.strokeStyle = "#b0b9a4";
    ctx.setLineDash([12, 14]);
    ctx.lineWidth = 2;
    for (const x of [420, 900, 1380]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (const y of [200, 600, 1000]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  } else if (map === "space") {
    for (let i = 0; i < 200; i++) {
      const x = (Math.sin(i * 342.21) * 0.5 + 0.5) * width;
      const y = (Math.cos(i * 87.12) * 0.5 + 0.5) * height;
      ctx.fillStyle = i % 4 ? "#a89bc455" : "#e8dcff";
      ctx.fillRect(x, y, i % 4 ? 1.5 : 2.5, i % 4 ? 1.5 : 2.5);
    }
  } else {
    ctx.fillStyle = "#3b624a";
    for (let i = 0; i < 130; i++) {
      const x = (i * 137.5) % width,
        y = (i * 273.7) % height;
      ctx.beginPath();
      ctx.ellipse(x, y, 7, 3, i, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = t.accent;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, width - 6, height - 6);
}

export function drawObject(ctx, obj, edible = false) {
  const r = obj.radius;
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.fillStyle = "#0c1a1425";
  ctx.beginPath();
  ctx.ellipse(3, r * 0.6, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  switch (obj.type) {
    case "cone":
      ctx.fillStyle = "#cb7546";
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, r * 0.65);
      ctx.lineTo(-r * 0.7, r * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#f1e5be";
      ctx.fillRect(-r * 0.36, -r * 0.03, r * 0.72, r * 0.25);
      break;
    case "car":
      ctx.fillStyle = "#4f6446";
      ctx.fillRect(-r * 0.65, -r, r * 1.3, r * 2);
      ctx.fillStyle = "#a8bd9c";
      ctx.fillRect(-r * 0.45, -r * 0.55, r * 0.9, r * 0.55);
      ctx.fillRect(-r * 0.45, r * 0.4, r * 0.9, r * 0.35);
      ctx.fillStyle = "#293524";
      for (const x of [-r * 0.85, r * 0.65])
        for (const y of [-r * 0.7, r * 0.5])
          ctx.fillRect(x, y, r * 0.2, r * 0.4);
      break;
    case "building":
      ctx.fillStyle = "#6e7d5c";
      ctx.fillRect(-r * 0.8 + 6, -r + 7, r * 1.6, r * 1.8);
      ctx.fillStyle = "#8b9d75";
      ctx.fillRect(-r * 0.8, -r, r * 1.6, r * 1.8);
      ctx.strokeStyle = "#b4c19d";
      ctx.lineWidth = 2;
      ctx.strokeRect(-r * 0.62, -r * 0.8, r * 1.24, r * 1.4);
      ctx.fillStyle = "#5f7251";
      ctx.fillRect(-r * 0.2, -r * 0.5, r * 0.65, r * 0.5);
      break;
    case "mushroom":
      ctx.fillStyle = "#d9c9a2";
      ctx.fillRect(-r * 0.2, 0, r * 0.4, r * 0.8);
      ctx.fillStyle = "#d89679";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffe7c1";
      ctx.beginPath();
      ctx.arc(-r * 0.2, -r * 0.4, r * 0.15, 0, Math.PI * 2);
      ctx.fill();
      break;
    case "bush":
      ctx.fillStyle = "#6d9968";
      for (const [x, y] of [
        [-r * 0.4, 0],
        [r * 0.4, 0],
        [0, -r * 0.4],
      ]) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case "tree":
      ctx.fillStyle = "#a07c55";
      ctx.fillRect(-r * 0.15, r * 0.2, r * 0.3, r * 0.75);
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = ["#496d46", "#5d8651", "#78a062"][i];
        ctx.beginPath();
        ctx.moveTo(0, -r + i * r * 0.37);
        ctx.lineTo(r * (0.8 - i * 0.13), r * 0.6 - i * r * 0.12);
        ctx.lineTo(-r * (0.8 - i * 0.13), r * 0.6 - i * r * 0.12);
        ctx.closePath();
        ctx.fill();
      }
      break;
    case "crystal":
      ctx.fillStyle = "#c0adf4";
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.7, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#8b73c6";
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.7, 0);
      ctx.closePath();
      ctx.fill();
      break;
    case "satellite":
      ctx.save();
      ctx.rotate(0.45);
      ctx.fillStyle = "#7167ac";
      ctx.fillRect(-r, -r * 0.5, r * 0.65, r);
      ctx.fillRect(r * 0.35, -r * 0.5, r * 0.65, r);
      ctx.strokeStyle = "#b4a3d7";
      ctx.lineWidth = 1;
      ctx.strokeRect(-r, -r * 0.5, r * 0.65, r);
      ctx.strokeRect(r * 0.35, -r * 0.5, r * 0.65, r);
      ctx.fillStyle = "#c8c3d5";
      ctx.fillRect(-r * 0.3, -r * 0.4, r * 0.6, r * 0.8);
      ctx.restore();
      break;
    case "planet":
      ctx.fillStyle = "#a494c4";
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#79679d";
      ctx.beginPath();
      ctx.arc(-r * 0.25, -r * 0.15, r * 0.23, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(r * 0.3, r * 0.3, r * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c6b382";
      ctx.lineWidth = r * 0.13;
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.2, r * 0.25, -0.4, 0, Math.PI * 2);
      ctx.stroke();
      break;
  }
  if (edible) {
    ctx.strokeStyle = "#ecffd688";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, r + 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawHole(ctx, player, isYou, time = 0) {
  ctx.save();
  ctx.translate(player.x, player.y);
  const r = player.radius;
  ctx.fillStyle = "#05070533";
  ctx.beginPath();
  ctx.ellipse(4, 8, r * 1.1, r * 0.86, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = player.color;
  ctx.lineWidth = 4;
  ctx.fillStyle = "#050704";
  ctx.beginPath();
  ctx.ellipse(0, 0, r, r * 0.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = player.color + "55";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    r * 0.83,
    r * 0.63,
    0,
    time * 0.0008,
    time * 0.0008 + Math.PI * 1.3,
  );
  ctx.stroke();
  ctx.fillStyle = "#11170ee8";
  const name = isYou ? "YOU" : player.username;
  ctx.font = "bold 11px Arial";
  const w = ctx.measureText(name).width + 18;
  ctx.fillRect(-w / 2, -r - 29, w, 20);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = player.color;
  ctx.fillText(name, 0, -r - 19);
  ctx.restore();
}

export function renderPreview(canvas) {
  const ctx = canvas.getContext("2d");
  function draw() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width * 0.5, rect.height * 0.47);
    const scale = Math.min(rect.width / 640, rect.height / 560);
    ctx.scale(scale, scale);
    ctx.rotate(-0.23);
    ctx.translate(-400, -300);
    ctx.fillStyle = "#a8b497";
    ctx.fillRect(35, 10, 730, 580);
    drawGround(ctx, "city", 800, 600);
    const items = [
      { x: 140, y: 100, radius: 42, type: "building" },
      { x: 230, y: 100, radius: 34, type: "building" },
      { x: 600, y: 110, radius: 46, type: "building" },
      { x: 680, y: 120, radius: 30, type: "building" },
      { x: 160, y: 440, radius: 42, type: "building" },
      { x: 260, y: 470, radius: 34, type: "building" },
      { x: 610, y: 460, radius: 40, type: "building" },
      { x: 700, y: 400, radius: 40, type: "building" },
      { x: 420, y: 80, radius: 20, type: "car" },
      { x: 420, y: 460, radius: 20, type: "car" },
      { x: 600, y: 200, radius: 18, type: "car" },
      { x: 190, y: 210, radius: 10, type: "cone" },
      { x: 230, y: 220, radius: 10, type: "cone" },
      { x: 490, y: 300, radius: 10, type: "cone" },
      { x: 520, y: 310, radius: 10, type: "cone" },
    ];
    items.forEach((o) => drawObject(ctx, o));
    drawHole(
      ctx,
      { x: 380, y: 330, radius: 95, color: "#d7ff91", username: "YOU" },
      true,
    );
    drawHole(
      ctx,
      { x: 600, y: 300, radius: 38, color: "#9584bd", username: "RIVAL" },
      false,
    );
    ctx.restore();
  }
  new ResizeObserver(draw).observe(canvas);
  draw();
}
