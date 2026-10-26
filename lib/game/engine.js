import { randomUUID } from "node:crypto";

export const WORLD = Object.freeze({ width: 1800, height: 1200 });
export const MAPS = Object.freeze({
  city: { label: "City", types: ["cone", "car", "building"] },
  forest: { label: "Forest", types: ["mushroom", "bush", "tree"] },
  space: { label: "Space", types: ["crystal", "satellite", "planet"] },
});
export const START_RADIUS = 30;
export const ROUND_SECONDS = 120;

function seededRandom(seed) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateObjects(
  map,
  seed = Math.floor(Math.random() * 2 ** 32),
) {
  const random = seededRandom(seed);
  const objects = [];
  // Mirrored placement gives both spawn points the same opportunities.
  const addPair = (x, y, tier) => {
    const radius = [8, 18, 38][tier];
    for (const [px, py] of [
      [x, y],
      [WORLD.width - x, WORLD.height - y],
    ]) {
      objects.push({
        id: objects.length,
        x: px,
        y: py,
        radius,
        type: MAPS[map].types[tier],
        points: [10, 30, 90][tier],
        mass: [110, 300, 900][tier],
      });
    }
  };
  // Small-object trails make the first growth possible on every map.
  for (let i = 0; i < 12; i++)
    addPair(245 + i * 34, 300 + Math.sin(i * 0.9) * 70, 0);
  for (let i = 0; i < 78; i++) {
    const tier = i < 32 ? 0 : i < 60 ? 1 : 2;
    addPair(100 + random() * 780, 100 + random() * 1000, tier);
  }
  return objects;
}

export function makePlayer(user, socketId, index) {
  return {
    userId: user.id,
    username: user.username,
    socketId,
    x: index === 0 ? 220 : WORLD.width - 220,
    y: index === 0 ? 300 : WORLD.height - 300,
    radius: START_RADIUS,
    score: 0,
    input: { x: 0, y: 0 },
    lastInput: 0,
    color: index === 0 ? "#c5f86b" : "#aa9bff",
  };
}

export function makeRoom(map, player) {
  return {
    id: randomUUID(),
    map,
    players: [player],
    objects: generateObjects(map),
    status: "waiting",
    startedAt: 0,
    deadline: 0,
    removed: [],
  };
}

export function setInput(player, input, now = Date.now()) {
  if (
    !input ||
    typeof input.x !== "number" ||
    typeof input.y !== "number" ||
    !Number.isFinite(input.x) ||
    !Number.isFinite(input.y)
  )
    return false;
  const length = Math.hypot(input.x, input.y);
  const divisor = Math.max(1, length);
  player.input = { x: input.x / divisor, y: input.y / divisor };
  player.lastInput = now;
  return true;
}

export function playerSpeed(radius) {
  return Math.max(150, 245 - (radius - START_RADIUS) * 0.55);
}

export function stepRoom(room, dt, now = Date.now()) {
  if (room.status !== "playing") return null;
  dt = Math.max(0, Math.min(dt, 0.05));
  for (const p of room.players) {
    const input = now - p.lastInput < 300 ? p.input : { x: 0, y: 0 };
    const speed = playerSpeed(p.radius);
    p.x = Math.max(
      p.radius,
      Math.min(WORLD.width - p.radius, p.x + input.x * speed * dt),
    );
    p.y = Math.max(
      p.radius,
      Math.min(WORLD.height - p.radius, p.y + input.y * speed * dt),
    );
  }
  const removed = new Set();
  for (const obj of room.objects) {
    // For contested objects, nearest eligible player wins; ties alternate by object ID.
    const eligible = room.players.filter(
      (p) =>
        obj.radius <= p.radius * 0.8 &&
        Math.hypot(p.x - obj.x, p.y - obj.y) + obj.radius <= p.radius,
    );
    eligible.sort(
      (a, b) =>
        Math.hypot(a.x - obj.x, a.y - obj.y) -
          Math.hypot(b.x - obj.x, b.y - obj.y) ||
        (obj.id % 2 === 0 ? a.userId - b.userId : b.userId - a.userId),
    );
    const p = eligible[0];
    if (!p) continue;
    p.radius = Math.min(190, Math.sqrt(p.radius ** 2 + obj.mass));
    p.score += obj.points;
    removed.add(obj.id);
  }
  room.removed.push(...removed);
  room.objects = room.objects.filter((obj) => !removed.has(obj.id));
  const [a, b] = room.players;
  if (a && b) {
    for (const [large, small] of [
      [a, b],
      [b, a],
    ]) {
      if (
        large.radius >= small.radius * 1.2 &&
        Math.hypot(large.x - small.x, large.y - small.y) + small.radius * 0.7 <
          large.radius
      ) {
        large.score += 100 + Math.floor(small.score / 4);
        large.radius = Math.min(
          190,
          Math.sqrt(large.radius ** 2 + small.radius ** 2 * 0.5),
        );
        return { winnerId: large.userId, reason: "absorbed" };
      }
    }
  }
  if (now >= room.deadline) {
    const ranked = [...room.players].sort((p, q) => q.score - p.score);
    return {
      winnerId: ranked[0].score === ranked[1].score ? null : ranked[0].userId,
      reason: "time",
    };
  }
  return null;
}

export function snapshot(room, now = Date.now()) {
  return {
    id: room.id,
    map: room.map,
    status: room.status,
    serverTime: now,
    remaining: Math.max(0, (room.deadline - now) / 1000),
    players: room.players.map(({ input, socketId, lastInput, ...p }) => p),
  };
}
