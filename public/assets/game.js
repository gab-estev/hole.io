import { CloudSocket } from "./cloud-socket.js";
import { themes, drawGround, drawObject, drawHole } from "./render.js";

const $ = (selector) => document.querySelector(selector);
const canvas = $("#game-canvas"),
  ctx = canvas.getContext("2d");
const labels = {
  city: "City limits",
  forest: "Forest feast",
  space: "Space case",
};
let user,
  socket,
  selectedMap = "city",
  phase = "idle",
  roomId = null,
  world = { width: 1800, height: 1200 };
let objects = new Map(),
  players = [],
  latest = null,
  previous = null,
  receivedAt = 0,
  joined = false,
  joinPending = false;
let width = 800,
  height = 560,
  dpr = 1,
  camera = { x: 900, y: 600, scale: 1 };
const keys = new Set();
let pointer = null;
let input = { x: 0, y: 0 };
let terrain = document.createElement("canvas");
let currentLobby = null;
let groundMap = null;
let particles = [];
let lastFrame = performance.now();

async function api(path, options = {}) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  if (res.status === 401) {
    location.replace("/");
    throw new Error("Please sign in again.");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function resetInput() {
  keys.clear();
  pointer = null;
  input = { x: 0, y: 0 };
  if (socket?.connected) socket.emit("input", input);
}
function makeTerrain(map) {
  groundMap = map;
  terrain.width = world.width;
  terrain.height = world.height;
  drawGround(terrain.getContext("2d"), map, world.width, world.height);
}
function resize() {
  const rect = canvas.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
}
new ResizeObserver(resize).observe(canvas);
function overlay(eyebrow, title, copy) {
  $("#overlay").hidden = false;
  $("#overlay-eyebrow").textContent = eyebrow;
  $("#overlay-title").textContent = title;
  $("#overlay-copy").textContent = copy;
}
function setPhase(next) {
  phase = next;
  const inMatch = next === "playing" || next === "waiting";
  $("#join").hidden = inMatch;
  $("#join").disabled = !socket?.connected || joinPending;
  $("#leave").hidden = !inMatch;
  $("#leave").textContent =
    next === "playing" ? "Leave round (forfeit)" : "Cancel waiting";
  $("#scoreboard").hidden = next !== "playing";
  document.querySelectorAll("[data-map]").forEach((el) => {
    el.disabled = inMatch || joinPending;
  });
}
function lobbyText() {
  const el = $("#lobby-status");
  if (!socket?.connected) {
    el.textContent = "Connecting to the arena…";
    return;
  }
  if (phase === "waiting") {
    el.textContent = "You’re in. Ask a friend to choose this map and join.";
    return;
  }
  if (phase === "playing") {
    el.textContent = "Round in progress. Leave the round to forfeit.";
    return;
  }
  el.textContent = currentLobby
    ? currentLobby.status === "playing"
      ? "The arena is full. A new round opens when this one ends."
      : `A rival is waiting in ${labels[currentLobby.map]}. Choose that map to join.`
    : "The arena is open. Be the first to jump in.";
}
function updateStats(stats) {
  $("#stat-best").textContent = stats.best;
  $("#stat-wins").textContent = stats.wins;
  $("#stat-games").textContent = stats.games;
}
async function history() {
  try {
    const data = await api("/api/history");
    updateStats(data.stats);
    const container = $("#history");
    container.replaceChildren();
    if (!data.matches.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Your first round is waiting to happen.";
      container.append(p);
    }
    for (const m of data.matches) {
      const row = document.createElement("div");
      row.className = "history-row";
      const badge = document.createElement("span");
      badge.className = `result-badge ${m.result}`;
      badge.textContent = { win: "WIN", loss: "LOSS", draw: "DRAW" }[m.result];
      const map = document.createElement("div");
      map.textContent = labels[m.map];
      const reason = document.createElement("small");
      reason.textContent =
        {
          time: "Time’s up",
          absorbed: "A rival was swallowed",
          opponent_left: "Round ended by forfeit",
        }[m.reason] || m.reason;
      map.append(reason);
      const score = document.createElement("strong");
      score.textContent = `${m.score.toLocaleString()} pts`;
      const time = document.createElement("time");
      time.dateTime = new Date(m.ended_at).toISOString();
      time.textContent = new Date(m.ended_at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
      time.title = new Date(m.ended_at).toLocaleString();
      row.append(badge, map, score, time);
      container.append(row);
    }
  } catch (err) {
    $("#game-error").textContent = err.message;
  }
}

document.querySelectorAll("[data-map]").forEach((button) =>
  button.addEventListener("click", () => {
    if (joined || joinPending) return;
    selectedMap = button.dataset.map;
    document.querySelectorAll("[data-map]").forEach((el) => {
      el.classList.toggle("selected", el === button);
      el.setAttribute("aria-pressed", String(el === button));
    });
    $("#map-label").textContent = labels[selectedMap].toUpperCase();
    makeTerrain(selectedMap);
    if (phase === "ended") {
      setPhase("idle");
      overlay(
        "YOUR TABLE IS READY",
        "Another world. Another appetite.",
        "Enter the arena to start your next round.",
      );
    }
  }),
);
$("#join").addEventListener("click", () => {
  if (!socket?.connected || joined || joinPending) return;
  joinPending = true;
  setPhase(phase);
  $("#game-error").textContent = "";
  socket
    .timeout(5000)
    .emit("match:join", { map: selectedMap }, (err, result) => {
      joinPending = false;
      if (err) {
        $("#game-error").textContent =
          "The server did not reply. Reconnecting…";
        socket.disconnect();
        socket.connect();
        setPhase("idle");
        return;
      }
      if (result?.error) {
        $("#game-error").textContent = result.error;
        setPhase(phase);
        return;
      }
      joined = true;
      setPhase(phase);
    });
});
$("#leave").addEventListener("click", () => {
  if (!joined) return;
  socket.emit("match:leave");
  joined = false;
  roomId = null;
  resetInput();
  setPhase("idle");
  lobbyText();
  overlay(
    "TAKE A BREATHER",
    "The next round is yours.",
    "Choose a map and enter the arena when you’re ready.",
  );
});
$("#logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", { method: "POST" });
    socket?.disconnect();
    location.assign("/");
  } catch (err) {
    $("#game-error").textContent = err.message;
  }
});
$("#refresh-history").addEventListener("click", history);

function wireSocket() {
  socket = new CloudSocket();
  socket.on("connect", () => {
    $("#connection").textContent = "CONNECTED";
    $("#connection-dot").classList.remove("offline");
    $("#game-error").textContent = "";
    setPhase(phase);
    lobbyText();
  });
  socket.on("connect_error", (err) => {
    $("#connection").textContent = "OFFLINE";
    $("#connection-dot").classList.add("offline");
    $("#game-error").textContent =
      err.message === "xhr poll error"
        ? "Could not reach the server. Check your connection and website origin."
        : err.message;
    if (err.message.includes("sign in")) location.replace("/");
  });
  socket.on("disconnect", (reason) => {
    const wasJoined = joined;
    joined = false;
    joinPending = false;
    roomId = null;
    resetInput();
    setPhase("idle");
    lobbyText();
    $("#connection").textContent = "RECONNECTING";
    $("#connection-dot").classList.add("offline");
    $("#ping").textContent = "— ms";
    if (wasJoined) {
      overlay(
        "CONNECTION LOST",
        "The arena connection was lost.",
        "Disconnecting forfeits an active round. Rejoin when the connection returns.",
      );
      void history();
    }
    if (reason === "io server disconnect")
      $("#connection").textContent = "DISCONNECTED";
  });
  socket.on("session:expired", () => {
    socket.disconnect();
    location.replace("/");
  });
  socket.on("lobby", (data) => {
    currentLobby = data;
    lobbyText();
  });
  socket.on("match:waiting", (data) => {
    joined = true;
    setPhase("waiting");
    lobbyText();
    overlay(
      "WAITING FOR PLAYER TWO",
      "Good things come to those who eat. ",
      `You’re in ${labels[data.map]}.\nHave a friend sign in with a different account and join this map.`,
    );
  });
  socket.on("match:start", (data) => {
    joined = true;
    joinPending = false;
    roomId = data.id;
    world = data.world;
    objects = new Map(data.objects.map((o) => [o.id, o]));
    players = data.players.map((p) => ({ ...p }));
    latest = data;
    previous = data;
    receivedAt = performance.now();
    particles = [];
    makeTerrain(data.map);
    resetInput();
    const me = players.find((p) => p.userId === user.id);
    camera = { x: me.x, y: me.y, scale: 1 };
    setPhase("playing");
    lobbyText();
    $("#overlay").hidden = true;
    $("#map-label").textContent = labels[data.map].toUpperCase();
    canvas.focus({ preventScroll: true });
  });
  socket.on("state", (data) => {
    if (data.id !== roomId) return;
    // Reliable ordered snapshots carry removals; objects are never client-authoritative.
    for (const id of data.removed) {
      const obj = objects.get(id);
      if (obj) {
        particles.push({ x: obj.x, y: obj.y, r: obj.radius, life: 0.45 });
        objects.delete(id);
      }
    }
    previous = latest;
    latest = data;
    receivedAt = performance.now();
  });
  socket.on("match:ended", (data) => {
    if (roomId && data.id !== roomId) return;
    const wasLeaving = !joined;
    joined = false;
    joinPending = false;
    roomId = null;
    resetInput();
    players = data.players.map((p) => ({ ...p }));
    latest = data;
    setPhase("ended");
    lobbyText();
    const me = data.players.find((p) => p.userId === user.id);
    if (!me) return;
    const outcome =
      data.winnerId === null
        ? "An appetite for a rematch."
        : data.winnerId === user.id
          ? "You ate. Literally."
          : "A little room to grow.";
    const reason = {
      absorbed: "The bigger hole swallowed its rival.",
      time: "Two minutes. Every bite counted.",
      opponent_left: "A player left the arena. The other player wins.",
    }[data.reason];
    if (!wasLeaving)
      overlay(
        data.winnerId === null
          ? "DRAW"
          : data.winnerId === user.id
            ? "VICTORY"
            : "ROUND COMPLETE",
        outcome,
        `${reason}\nYour score: ${me.score.toLocaleString()} points. ${data.saved ? "Saved to your history." : "Score could not be saved."}\nChoose a map to play again.`,
      );
    void history();
  });
  socket.connect();
}

const movementKeys = [
  "w",
  "a",
  "s",
  "d",
  "arrowup",
  "arrowleft",
  "arrowdown",
  "arrowright",
];
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (
    phase === "playing" &&
    movementKeys.includes(key) &&
    !["INPUT", "TEXTAREA", "BUTTON"].includes(event.target.tagName)
  ) {
    event.preventDefault();
    keys.add(key);
  }
});
window.addEventListener("keyup", (event) =>
  keys.delete(event.key.toLowerCase()),
);
window.addEventListener("blur", resetInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetInput();
});
canvas.addEventListener("pointerdown", (event) => {
  if (phase !== "playing") return;
  canvas.focus({ preventScroll: true });
  canvas.setPointerCapture(event.pointerId);
  pointer = { x: event.clientX, y: event.clientY };
});
canvas.addEventListener("pointermove", (event) => {
  if (pointer) pointer = { x: event.clientX, y: event.clientY };
});
for (const name of ["pointerup", "pointercancel", "lostpointercapture"])
  canvas.addEventListener(name, () => {
    pointer = null;
  });
function readInput() {
  let x =
    Number(keys.has("d") || keys.has("arrowright")) -
    Number(keys.has("a") || keys.has("arrowleft"));
  let y =
    Number(keys.has("s") || keys.has("arrowdown")) -
    Number(keys.has("w") || keys.has("arrowup"));
  if (!x && !y && pointer) {
    const me = players.find((p) => p.userId === user?.id);
    if (me) {
      const rect = canvas.getBoundingClientRect();
      const screenX = (me.x - camera.x) * camera.scale + width / 2;
      const screenY = (me.y - camera.y) * camera.scale + height / 2;
      const dx = pointer.x - rect.left - screenX,
        dy = pointer.y - rect.top - screenY;
      const len = Math.hypot(dx, dy);
      if (len > 10) {
        x = dx / Math.max(80, len);
        y = dy / Math.max(80, len);
      }
    }
  }
  const len = Math.hypot(x, y);
  input = { x: x / Math.max(1, len), y: y / Math.max(1, len) };
}
setInterval(() => {
  if (phase === "playing" && socket?.connected) {
    readInput();
    socket.volatile.emit("input", input);
  }
}, 1000 / 30);
setInterval(() => {
  if (socket?.connected) {
    const start = performance.now();
    socket.timeout(3000).emit("ping:check", (err) => {
      if (!err)
        $("#ping").textContent = `${Math.round(performance.now() - start)} ms`;
    });
  }
}, 2000);

function render(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05);
  lastFrame = now;
  if (!groundMap) makeTerrain(selectedMap);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = themes[groundMap].ground;
  ctx.fillRect(0, 0, width, height);
  const active = phase === "playing" && latest;
  if (active) {
    const alpha = Math.max(0, Math.min(1, (now - receivedAt) / 50));
    players = latest.players.map((p) => {
      const old = previous?.players.find((q) => q.userId === p.userId) || p;
      let x = old.x + (p.x - old.x) * alpha,
        y = old.y + (p.y - old.y) * alpha;
      if (p.userId === user.id) {
        // Predict at most 100 ms of local movement, then correct from authoritative state.
        const lead = Math.min((now - receivedAt) / 1000, 0.1);
        const speed = Math.max(150, 245 - (p.radius - 30) * 0.55);
        x = p.x + input.x * speed * lead;
        y = p.y + input.y * speed * lead;
      }
      return {
        ...p,
        x: Math.max(p.radius, Math.min(world.width - p.radius, x)),
        y: Math.max(p.radius, Math.min(world.height - p.radius, y)),
      };
    });
  }
  const me = players.find((p) => p.userId === user?.id);
  if (me && active) {
    const targetScale =
      Math.min(width / 680, height / 540) *
      Math.max(0.52, 1 - (me.radius - 30) / 250);
    const factor = 1 - Math.exp(-dt * 10);
    camera.x += (me.x - camera.x) * factor;
    camera.y += (me.y - camera.y) * factor;
    camera.scale += (targetScale - camera.scale) * factor;
  } else if (!joined) {
    camera.x = world.width / 2;
    camera.y = world.height / 2;
    camera.scale = Math.max(width / world.width, height / world.height);
  }
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-camera.x, -camera.y);
  ctx.drawImage(terrain, 0, 0);
  for (const obj of objects.values()) {
    if (
      Math.abs(obj.x - camera.x) > width / (2 * camera.scale) + 60 ||
      Math.abs(obj.y - camera.y) > height / (2 * camera.scale) + 60
    )
      continue;
    drawObject(ctx, obj, active && me && obj.radius <= me.radius * 0.8);
  }
  for (const p of players) drawHole(ctx, p, p.userId === user?.id, now);
  for (const p of particles) {
    p.life -= dt;
    ctx.globalAlpha = Math.max(0, p.life / 0.45);
    ctx.strokeStyle = themes[groundMap].accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r + (1 - p.life / 0.45) * 20, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  particles = particles.filter((p) => p.life > 0);
  ctx.restore();
  if (active && me) {
    const rival = players.find((p) => p.userId !== user.id);
    $("#you-name").textContent = `${me.username} · YOU`;
    $("#you-score").textContent = me.score.toLocaleString();
    if (rival) {
      $("#rival-name").textContent = rival.username;
      $("#rival-score").textContent = rival.score.toLocaleString();
    }
    const remaining = Math.max(
      0,
      Math.ceil(latest.remaining - (now - receivedAt) / 1000),
    );
    $("#timer").textContent =
      `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
    $("#size-label").textContent =
      `SIZE ${Math.round((me.radius / 30) * 100)}% · ${rival && me.radius >= rival.radius * 1.2 ? "YOUR RIVAL IS ON THE MENU" : rival && rival.radius >= me.radius * 1.2 ? "WATCH OUT — YOUR RIVAL CAN EAT YOU" : "KEEP GROWING"}`;
    // A compact full-map view helps players find each other when zoomed in.
    const mw = 112,
      mh = (mw * world.height) / world.width,
      mx = width - mw - 16,
      my = height - mh - 40;
    ctx.fillStyle = "#10160dd9";
    ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = "#c1cdb36a";
    ctx.strokeRect(mx, my, mw, mh);
    for (const p of players) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(
        mx + (p.x / world.width) * mw,
        my + (p.y / world.height) * mh,
        p.userId === user.id ? 3.5 : 3,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
  requestAnimationFrame(render);
}
try {
  const data = await api("/api/me");
  user = data.user;
  $("#account-name").textContent = user.username;
  updateStats(data.stats);
  wireSocket();
  void history();
} catch (err) {
  $("#game-error").textContent = err.message;
}
resize();
requestAnimationFrame(render);

