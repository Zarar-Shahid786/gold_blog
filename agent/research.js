import { generateJson } from "./gemini.js";

const CLUSTERS = new Set(["gold", "coin", "vr"]);
const SEARCH_VERSION = 2;

export async function refreshKeywords(gemini, store, today) {
  if (
    store.updatedOn === today &&
    store.searchVersion === SEARCH_VERSION &&
    store.keywords.length > 0 &&
    store.notes
  ) {
    return { store, added: 0, addedTerms: [] };
  }

  const known = store.keywords.map((item) => item.term).join(", ") || "none";
  const result = await generateJson(gemini, {
    search: true,
    temperature: 0.2,
    maxOutputTokens: 900,
    prompt: `Search Google for queries a new Gold Hunter website can rank for quickly and that can bring visitors.
Cover gold rates, gold hunting, gold coins, coin hunting, and VR coin games.

Return JSON only:
{
  "notes": "Facts from the search, under 500 characters. Include a gold price only if the result showed the number, currency, and source. Omit every figure you did not find.",
  "keywords": [
    { "term": "3 to 6 word long-tail phrase", "cluster": "gold", "reason": "why a new site can rank for this and get traffic" }
  ]
}

Rules:
- Return 9 phrases: 3 gold, 3 coin, 3 vr.
- Prefer how-to, today, beginner, best, guide, and comparison phrases. These rank faster than broad words.
- Do not return a single word such as gold or coin.
- Do not return any phrase already saved: ${known}`
  });

  const incoming = Array.isArray(result.keywords) ? result.keywords : [];
  const merged = mergeKeywords(store.keywords, incoming, today);
  const next = {
    updatedOn: today,
    searchVersion: SEARCH_VERSION,
    notes: String(result.notes || store.notes || "").slice(0, 500),
    keywords: merged.keywords
  };

  if (!next.keywords.length) {
    throw new Error("Keyword search returned nothing new and the saved list is empty");
  }

  return { store: next, added: merged.added, addedTerms: merged.addedTerms };
}

export function pickKeyword(keywords, posts) {
  const uses = useCounts(posts);

  const preferred = ["gold", "coin", "vr"][posts.length % 3];
  const pool = keywords.filter((item) => item.cluster === preferred);
  const list = (pool.length ? pool : keywords).slice().sort((left, right) => {
    return (uses.get(normalizeTitle(left.term)) || 0) - (uses.get(normalizeTitle(right.term)) || 0);
  });
  return list[0];
}

export async function chooseKeyword(gemini, { keywords, posts, notes }) {
  const uses = useCounts(posts);
  const lines = keywords
    .map((item) => {
      const used = uses.get(normalizeTitle(item.term)) || 0;
      return `- ${item.term} | ${item.cluster} | used ${used} | ${item.reason || ""}`;
    })
    .join("\n");

  try {
    const choice = await generateJson(gemini, {
      temperature: 0.2,
      maxOutputTokens: 320,
      json: true,
      prompt: `Pick the one saved phrase most likely to bring new visitors and rank a new Gold Hunter site fastest.
The site publishes about gold, real coins, and VR coin games.

Search notes:
${notes || "none"}

Saved phrases:
${lines}

Rules:
- Copy the term exactly from the saved list.
- Prefer an unused long-tail phrase over a broad phrase that was already used.
- Say which search intent it matches and why a new site can rank for it sooner.

Return JSON only:
{ "term": "exact saved phrase", "reasoning": "two sentences" }`
    });

    const found = keywords.find((item) => normalizeTitle(item.term) === normalizeTitle(choice.term || ""));
    if (found) {
      return { keyword: found, reasoning: String(choice.reasoning || "").trim() };
    }
  } catch (error) {
    console.error(`[gemini-agent] Keyword choice failed: ${error.message}`);
  }

  return {
    keyword: pickKeyword(keywords, posts),
    reasoning: "Using the least-used saved phrase because the ranking choice was not a saved keyword."
  };
}

export async function writePost(gemini, { keyword, notes, titles, previous, angle }) {
  const correction = previous ? `Fix the previous draft: ${previous}` : "";

  const draft = await generateJson(gemini, {
    temperature: 0.6,
    maxOutputTokens: 1400,
    json: true,
    prompt: `Write one original Gold Hunter blog. Reason first, then write.

Primary search phrase, use these exact words in the title and the first paragraph: ${keyword.term}
Why this phrase can rank: ${angle || keyword.reason || "specific search demand"}

Search notes. Use a number only when it appears here:
${notes || "No figures stored. Do not invent prices, dates, or player counts."}

Do not reuse these titles:
${titleBlock(titles)}
${correction}

Return JSON only:
{
  "reasoning": "Two sentences: the search intent, and how gold, real coins, and VR coin games connect in this article without repeating an old title.",
  "title": "unique title under 90 characters that includes the primary phrase or a close form of it",
  "subtitle": "one sentence under 140 characters",
  "paragraphs": ["six paragraphs"]
}

Rules:
- Exactly 6 paragraphs, plain text, no HTML or markdown.
- Paragraphs 1 and 2 are about gold. 3 and 4 are about real coins. 5 and 6 are about VR coin games, tied back to gold and coins.
- Teach something specific in each pair. Do not repeat the same point.
- Original sentences. Do not copy a source word for word.`
  });

  const paragraphs = Array.isArray(draft.paragraphs)
    ? draft.paragraphs.map((item) => String(item).trim()).filter(Boolean)
    : [];

  return {
    title: String(draft.title || "").trim(),
    subtitle: String(draft.subtitle || "").trim(),
    reasoning: String(draft.reasoning || "").trim(),
    paragraphs
  };
}

export function normalizeTitle(title) {
  return String(title).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function coversRequiredSubjects(paragraphs) {
  const text = paragraphs.join(" ").toLowerCase();
  const missing = [];
  if (!/\bgold\b/.test(text)) missing.push("gold");
  if (!/\bcoins?\b/.test(text)) missing.push("coins");
  if (!/\bvr\b|virtual reality/.test(text)) missing.push("VR coin games");
  return missing;
}

function useCounts(posts) {
  const uses = new Map();
  for (const post of posts) {
    const key = normalizeTitle(post.keyword || "");
    if (key) uses.set(key, (uses.get(key) || 0) + 1);
  }
  return uses;
}

function mergeKeywords(saved, incoming, today) {
  const byTerm = new Map(saved.map((item) => [normalizeTitle(item.term), item]));
  const addedTerms = [];

  for (const item of incoming) {
    const term = String(item.term || "").replace(/\s+/g, " ").trim();
    const key = normalizeTitle(term);
    if (!term || key.split(" ").length < 2 || byTerm.has(key)) continue;
    const cluster = CLUSTERS.has(item.cluster) ? item.cluster : "gold";
    byTerm.set(key, {
      term,
      cluster,
      reason: String(item.reason || "").slice(0, 180),
      addedOn: today
    });
    addedTerms.push(term);
  }

  return { keywords: [...byTerm.values()], added: addedTerms.length, addedTerms };
}

function titleBlock(titles) {
  if (!titles.length) return "None yet.";
  return titles.slice(-25).map((title) => `- ${title}`).join("\n");
}
