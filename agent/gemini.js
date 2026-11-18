import { sleep } from "./http.js";

const SYSTEM = "You are the editor of the Gold Hunter blog. When JSON is requested, return one JSON object and no other text.";

export function createGemini({ apiKey, model, baseUrl }) {
  return {
    generate(options) {
      return generate({ apiKey, model, baseUrl, ...options });
    }
  };
}

async function generate({ apiKey, model, baseUrl, prompt, search = false, temperature = 0.4, maxOutputTokens = 800, json = false }) {
  const root = gatewayRoot(baseUrl);
  const url = search
    ? `${root}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`
    : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const body = search
    ? {
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature, maxOutputTokens }
      }
    : {
        model,
        temperature,
        max_tokens: maxOutputTokens,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: prompt }
        ]
      };

  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(gatewayMessage(response.status, data));
        error.status = response.status;
        throw error;
      }

      const text = readText(data);
      if (!text) throw new Error("Gateway returned an empty response");
      return text;
    } catch (error) {
      lastError = error;
      const retry = error.status === 503 || error.name === "TimeoutError";
      if (!retry || attempt === 3) break;
      await sleep(2000 * attempt);
    }
  }

  throw lastError;
}

function gatewayRoot(baseUrl) {
  const url = new URL(baseUrl);
  return `${url.protocol}//${url.host}`;
}

function readText(data) {
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();

  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("")
    .trim();
}

function gatewayMessage(status, data) {
  if (status === 403) return "This key cannot use that model. Pick a model from the gateway whitelist.";
  if (status === 429) return "This key has reached its monthly gateway budget.";
  return data.error?.message || data.message || `Gateway HTTP ${status}`;
}

export function parseJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("Gemini did not return JSON");
  }
  return JSON.parse(text.slice(start, end + 1));
}

export async function generateJson(gemini, options) {
  const first = await gemini.generate(options);
  try {
    return parseJson(first);
  } catch (error) {
    if (options.json) throw error;
    const second = await gemini.generate({
      ...options,
      search: false,
      json: true,
      prompt: `${options.prompt}\n\nReply again with only the JSON object.`
    });
    return parseJson(second);
  }
}
