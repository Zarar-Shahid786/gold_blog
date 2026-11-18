import { calendarDate, clockInZone, daySlots, displayDate, loadConfig, slotIsDue } from "./config.js";
import { createGemini } from "./gemini.js";
import { publishWithRetries } from "./publish.js";
import { chooseKeyword, coversRequiredSubjects, normalizeTitle, refreshKeywords, writePost } from "./research.js";
import { readKeywords, readPosts, writeKeywords, writePosts } from "./store.js";

const IMAGES = [
  "https://upload.wikimedia.org/wikipedia/commons/d/d7/Gold-crystals.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/c/c6/Gold_bullion_2.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/9/9b/Goldinpan.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/0/0a/Dubai_gold_coins.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/e/ed/1_oz_Krugerrand_2017_Bildseite.png",
  "https://upload.wikimedia.org/wikipedia/commons/6/65/Liberty_%2450_Obverse.png",
  "https://upload.wikimedia.org/wikipedia/commons/1/16/Coin_collection.jpg",
  "https://upload.wikimedia.org/wikipedia/commons/e/ee/Reality_check_ESA384313.jpg",
  "https://images.unsplash.com/photo-1610375461246-83df859d849d?q=80&w=1200&auto=format&fit=crop"
];

let lastLog = "";

export async function runDue({ ignoreClock = false } = {}) {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error("Set GEMINI_API_KEY in .env");
  }

  const today = calendarDate(config.timezone);
  const slots = daySlots(config.blogsPerDay, config.startHour, config.endHour);
  const posts = await readPosts();
  const todayCount = posts.filter((post) => post.date === today).length;

  if (todayCount >= config.blogsPerDay) {
    log(`[gemini-agent] ${today}: ${todayCount}/${config.blogsPerDay} posts already saved`);
    return { skipped: true };
  }

  const slot = slots[todayCount];
  const clock = clockInZone(config.timezone);
  if (!ignoreClock && !slotIsDue(slot, clock)) {
    log(`[gemini-agent] ${today} ${clockLabel(clock)}: next post at ${slot} (${todayCount}/${config.blogsPerDay})`);
    return { skipped: true };
  }

  const gemini = createGemini({
    apiKey: config.apiKey,
    model: config.model,
    baseUrl: config.geminiBaseUrl
  });
  const keywordResult = await refreshKeywords(gemini, await readKeywords(), today);
  await writeKeywords(keywordResult.store);
  if (keywordResult.added > 0) {
    console.log(
      `[gemini-agent] Saved ${keywordResult.added} new keyword(s): ${keywordResult.addedTerms.join(", ")}. Bank size: ${keywordResult.store.keywords.length}`
    );
  }

  const publishedTitles = await blogTitles(config.apiBase);
  const titles = uniqueTitles([...posts.map((post) => post.title), ...publishedTitles]);
  let lastBlog = null;

  while (posts.filter((post) => post.date === today).length < config.blogsPerDay) {
    const chosen = await chooseKeyword(gemini, {
      keywords: keywordResult.store.keywords,
      posts,
      notes: keywordResult.store.notes
    });
    const keyword = chosen.keyword;
    if (!keyword) throw new Error("Keyword bank is empty");

    console.log(`[gemini-agent] ${today} ${slot}: ranking phrase "${keyword.term}"`);
    console.log(`[gemini-agent] Reasoning: ${oneLine(chosen.reasoning)}`);
    const draft = await draftUntilValid(gemini, {
      keyword,
      notes: keywordResult.store.notes,
      titles,
      angle: chosen.reasoning
    });

    const payload = {
      title: clip(draft.title, 255),
      subtitle: clip(draft.subtitle, 255),
      readTime: readTime(draft.paragraphs),
      date: displayDate(config.timezone),
      category: "Gold",
      tags: ["All", "Gold", "Coins", "VR Coin Games"],
      image: IMAGES[posts.length % IMAGES.length],
      content: draft.paragraphs
    };

    console.log(`[gemini-agent] Publishing "${payload.title}"`);
    const published = await publishWithRetries(config.apiBase, payload);
    posts.push({
      date: today,
      slot,
      id: published.data?.id ?? null,
      title: payload.title,
      keyword: keyword.term,
      reasoning: chosen.reasoning || draft.reasoning
    });
    titles.push(payload.title);
    await writePosts(posts);
    lastBlog = published.data;
    console.log(`[gemini-agent] Posted id ${published.data?.id}: ${payload.title}`);
  }

  lastLog = "";
  return { skipped: false, blog: lastBlog };
}

async function draftUntilValid(gemini, context) {
  let problem = "";

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const draft = await writePost(gemini, { ...context, previous: problem });
    const missing = coversRequiredSubjects(draft.paragraphs);
    const duplicate = context.titles.some((title) => normalizeTitle(title) === normalizeTitle(draft.title));

    const thinReason = draft.reasoning.length < 40;
    if (draft.paragraphs.length >= 6 && !missing.length && draft.title && !duplicate && !thinReason) {
      return draft;
    }

    problem = [
      draft.paragraphs.length < 6 ? "need 6 paragraphs" : "",
      missing.length ? `missing ${missing.join(", ")}` : "",
      !draft.title ? "missing title" : "",
      duplicate ? `title already used: ${draft.title}` : "",
      thinReason ? "reasoning too short" : ""
    ].filter(Boolean).join("; ");
    console.error(`[gemini-agent] Draft rejected: ${problem}`);
  }

  throw new Error(`Draft was not publishable: ${problem}`);
}

async function blogTitles(apiBase) {
  const response = await fetch(`${apiBase}/api/blogs`, { signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || "Could not read existing blogs");
  }
  return (body.data || []).map((blog) => blog.title).filter(Boolean);
}

function uniqueTitles(titles) {
  const seen = new Set();
  const unique = [];
  for (const title of titles) {
    const key = normalizeTitle(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(title);
  }
  return unique;
}

function readTime(paragraphs) {
  const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  return `${Math.max(1, Math.round(words / 200))} min read`;
}

function clip(value, max) {
  const text = String(value || "").trim();
  if (text.length <= max) return text;
  return text.slice(0, max - 3).trim();
}

function oneLine(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clockLabel(clock) {
  return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

function log(message) {
  if (message === lastLog) return;
  lastLog = message;
  console.log(message);
}
