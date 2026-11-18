import path from "node:path";
import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { daySlots, loadConfig } from "./config.js";
import { runDue } from "./run.js";

const once = process.argv.includes("--once");
const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (direct && once) {
  try {
    await runDue({ ignoreClock: true });
    process.exit(0);
  } catch (error) {
    console.error(`[gemini-agent] ${error.message}`);
    process.exit(1);
  }
}

if (direct) startAgent();

export function startAgent() {
  const config = loadConfig();
  if (!config.apiKey) {
    console.error("[gemini-agent] Add GEMINI_API_KEY to .env. The API will keep running.");
    return;
  }

  const slots = daySlots(config.blogsPerDay, config.startHour, config.endHour);
  let running = false;

  cron.schedule("* * * * *", () => {
    tick();
  }, { timezone: config.timezone });

  console.log(
    `[gemini-agent] ${config.blogsPerDay} blog(s) per day at ${slots[0]} (${config.timezone}). Model ${config.model}. Gateway ${config.geminiBaseUrl}.`
  );
  tick();

  async function tick() {
    if (running) return;
    running = true;
    try {
      await runDue();
    } catch (error) {
      console.error(`[gemini-agent] ${error.message}`);
    } finally {
      running = false;
    }
  }
}
