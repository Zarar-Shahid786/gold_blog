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

export async function articleFacts(gemini, keyword) {
  const result = await generateJson(gemini, {
    search: true,
    temperature: 0.1,
    maxOutputTokens: 700,
    prompt: `Search the web for this query only: "${keyword.term}"

Return JSON only:
{
  "facts": "What the sources say about this query, under 700 characters, with the source name.",
  "prices": ["Only prices the sources showed, each with the figure, unit, and source. Empty array if none."],
  "names": ["Only real game, simulator, coin, place, or product names the sources named. Empty array if none."]
}

Do not invent a price, a forecast, a game, or a product.`
  });

  const prices = Array.isArray(result.prices) ? result.prices.map((item) => String(item).trim()).filter(Boolean) : [];
  const names = Array.isArray(result.names) ? result.names.map((item) => String(item).trim()).filter(Boolean) : [];
  const aboutPrice = /price|rate|spot|forecast|tola|gram|karat|dollar/i.test(keyword.term);
  const live = aboutPrice ? await livePriceLine() : "This article is not a price post. Do not mention a gold price, silver price, troy ounce, or premium.";

  return {
    notes: [
      String(result.facts || "").slice(0, 700),
      live,
      prices.length ? `Source prices: ${prices.join(" | ")}` : "No other price was found. Do not add one.",
      names.length ? `Real names from sources: ${names.join(", ")}` : "No real product or game name was found. Do not invent one."
    ].filter(Boolean).join("\n"),
    names
  };
}

async function livePriceLine() {
  try {
    const response = await fetch("https://api.gold-api.com/price/XAU", { signal: AbortSignal.timeout(12000) });
    const gold = await response.json();
    const price = Number(gold.price);
    if (!response.ok || !Number.isFinite(price) || price <= 0) {
      return "Live gold price feed failed. Do not write any gold price.";
    }
    return `Live spot gold: ${price} ${gold.currency || "USD"} per troy ounce, feed time ${gold.updatedAt || "unknown"}, source gold-api.com.`;
  } catch {
    return "Live gold price feed failed. Do not write any gold price.";
  }
}

export async function writePost(gemini, { keyword, notes, titles, previous, angle, names = [] }) {
  const correction = previous ? `Fix the previous draft: ${previous}` : "";
  const topic = keyword.cluster === "vr" ? "VR coin games" : keyword.cluster === "coin" ? "coins" : "gold";

  const draft = await generateJson(gemini, {
    temperature: 0.5,
    maxOutputTokens: 1400,
    json: true,
    prompt: `Write one Gold Hunter article about one topic only: ${topic}.
Keyword: ${keyword.term}
Why it can rank: ${angle || keyword.reason || "specific search demand"}

Source notes. A price or a product name may be used only when it appears here:
${notes || "No sources. Do not write any price or product name."}

Real names you may use: ${names.length ? names.join(", ") : "none"}

Do not reuse these titles:
${titleBlock(titles)}
${correction}

Return JSON only:
{
  "reasoning": "One sentence on the search intent of this single topic.",
  "title": "a direct search-style title of 60 characters or fewer",
  "subtitle": "one sentence under 140 characters",
  "paragraphs": ["six paragraphs only about this topic"]
}

Rules:
- One topic. Do not add a second subject. A gold post does not discuss VR or coin roll hunting. A coin post does not discuss VR or the gold spot price. A VR post does not discuss troy ounces, spot price, premiums, or coin roll hunting.
- Write the keyword in normal English. "beginner guide gold prospecting" becomes "a beginner's guide to gold prospecting", not "this beginner guide gold prospecting article".
- The title is what a person would type into Google. No poetic titles.
- Put the topic in the first paragraph naturally.
- If the keyword says best, top, games, or simulator, name at least two real names from the source notes. If the notes have no names, do not call anything the best and do not invent a name.
- Do not write a price, rate, karat value, or forecast unless that exact figure is in the source notes.
- Do not repeat a generic explanation of troy ounces, premiums, or coin roll hunting unless the keyword is about that exact subject.
- Six plain paragraphs. No HTML or markdown.`
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

export function draftProblems({ title, paragraphs, html = "", keyword, notes, names }) {
  const problems = [];
  const text = paragraphs.join(" ");
  const lower = text.toLowerCase();
  const cluster = keyword.cluster;
  const term = keyword.term.toLowerCase();

  if (!title || title.length > 65) problems.push("title must be 60 characters or fewer and written like a search");
  if (cluster !== "vr" && /\bvr\b|virtual reality/.test(lower)) problems.push("remove VR from this post");
  if (cluster !== "coin" && /coin roll hunting/.test(lower)) problems.push("remove coin roll hunting");
  if (cluster === "vr" && /spot price|troy ounce|coin roll hunting|premium over spot/.test(lower)) {
    problems.push("VR post must not repeat gold price or coin roll content");
    problems.push("under each product include price, size, pros, cons, and who it is for, and say when a source did not list that detail");
  }
  if (/popular choice|preferred by|excellent visibility|highly recommended|experts agree|most popular/i.test(lower)) {
    problems.push("remove praise that the source notes do not state");
  }
  if (/pann/.test(term) && !/detector/.test(term) && /gold monster|metal detector/i.test(lower)) {
    problems.push("this is a panning post; move metal detectors such as the Gold Monster 1000 to a detector article");
  }
  if (cluster !== "vr" && /\bvr\b|virtual reality/.test(lower)) problems.push("remove VR from this post");
  if (cluster !== "coin" && /coin roll hunting/.test(lower)) problems.push("remove coin roll hunting");
  if (cluster === "vr" && /spot price|troy ounce|coin roll hunting|premium over spot/.test(lower)) {
    problems.push("VR post must not repeat gold price or coin roll content");
  }
  if (!/price|rate|spot|forecast|tola|gram|karat|ounce|premium/.test(term) && /spot price|troy ounce|per ounce/.test(lower)) {
    problems.push("do not repeat the spot price explanation in this post");
  }

  const words = term.split(/\s+/).filter((word) => word.length > 3);
  const intro = html.split(/<h2/i)[0].replace(/<[^>]+>/g, " ").toLowerCase();
  if (words.length && words.filter((word) => intro.includes(word.replace(/'s$/, ""))).length < Math.min(2, words.length)) {
    problems.push("mention the topic naturally in the opening");
  }

  for (const hit of text.match(/(?:\$|usd)\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:per ounce|per tola|per gram|dollars)/gi) || []) {
    const digits = hit.replace(/[^\d.]/g, "");
    if (digits && !String(notes).includes(digits)) problems.push(`remove the unsourced price ${hit}`);
  }

  if (/\b(best|top|games|simulator)\b/.test(term)) {
    const used = names.filter((name) => name.length > 2 && lower.includes(name.toLowerCase()));
    if (used.length < 2) problems.push("name at least two real products from the source notes, or do not promise a best-of list");
  }

  return problems;
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
