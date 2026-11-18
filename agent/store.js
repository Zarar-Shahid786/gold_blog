import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");

async function readJson(name, fallback) {
  try {
    return JSON.parse(await readFile(path.join(dataDir, name), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(name, value) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, name), JSON.stringify(value, null, 2));
}

export function readPosts() {
  return readJson("posts.json", []);
}

export function writePosts(posts) {
  return writeJson("posts.json", posts);
}

export function readKeywords() {
  return readJson("keywords.json", { updatedOn: "", notes: "", keywords: [] });
}

export function writeKeywords(store) {
  return writeJson("keywords.json", store);
}
