import { sleep } from "./http.js";

export async function publishBlog(apiBase, payload) {
  const url = `${apiBase}/api/blogs`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000)
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok || body.success === false) {
      const error = new Error(body.message || `Publish failed with HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return body;
  } catch (error) {
    if (error.cause?.code === "ECONNREFUSED" || /fetch failed|ECONNREFUSED/i.test(error.message)) {
      throw new Error(`Blog API is not reachable at ${url}. Start it with npm start.`);
    }
    throw error;
  }
}

export async function publishWithRetries(apiBase, payload, { attempts = 5, delayMs = 2000 } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await publishBlog(apiBase, payload);
    } catch (error) {
      lastError = error;
      const clientError = error.status >= 400 && error.status < 500;
      if (clientError || attempt === attempts) break;
      console.error(`[gemini-agent] Publish attempt ${attempt} failed: ${error.message}`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}
