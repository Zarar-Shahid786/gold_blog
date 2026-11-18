import dotenv from "dotenv";

dotenv.config();

export function loadConfig() {
  const port = process.env.PORT || 5000;
  const startHour = integer("POST_START_HOUR", 9, 0, 23);
  const endHour = integer("POST_END_HOUR", 18, 0, 23);
  if (endHour < startHour) {
    throw new Error("POST_END_HOUR must be the same hour as POST_START_HOUR or later");
  }

  return {
    apiBase: (process.env.AGENT_API_BASE || `http://127.0.0.1:${port}`).replace(/\/$/, ""),
    timezone: process.env.AGENT_TIMEZONE || "Asia/Karachi",
    blogsPerDay: integer("BLOGS_PER_DAY", 1, 1, 12),
    startHour,
    endHour,
    apiKey: (process.env.GEMINI_API_KEY || "").trim(),
    geminiBaseUrl: (process.env.GEMINI_BASE_URL || "http://86.48.3.185:3001/v1").replace(/\/$/, ""),
    model: (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim()
  };
}

export function calendarDate(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function displayDate(timeZone, date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

export function clockInZone(timeZone, date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  let hour = Number(parts.hour);
  if (hour === 24) hour = 0;
  return { hour, minute: Number(parts.minute) };
}

export function daySlots(count, startHour) {
  const slot = clockLabel(startHour * 60);
  return Array.from({ length: count }, () => slot);
}

export function slotIsDue(slot, clock) {
  const [hour, minute] = slot.split(":").map(Number);
  return clock.hour > hour || (clock.hour === hour && clock.minute >= minute);
}

function clockLabel(totalMinutes) {
  const hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function integer(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}`);
  }
  return value;
}
