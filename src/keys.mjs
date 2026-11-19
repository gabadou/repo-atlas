// The AI key for `atlas serve`, kept once for every project: in the macOS keychain on a Mac, elsewhere in
// ~/.config/repo-atlas/keys.json (readable by you only). ANTHROPIC_API_KEY or OPENAI_API_KEY in the
// environment work too. The key never goes to the page: the server makes the summary requests itself.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const DIR = path.join(os.homedir(), ".config", "repo-atlas");
const SETTINGS = path.join(DIR, "settings.json"); // provider and model, no secret
const FILE = path.join(DIR, "keys.json");
const SERVICE = "repo-atlas";
const ENV = { claude: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export const where = () => (process.platform === "darwin" && process.env.ATLAS_KEYSTORE !== "file" ? "keychain" : "file");

const readJson = (file) => {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; }
};
const writeJson = (file, value) => {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
};

const memo = new Map(); // provider -> key, so the keychain is read once per run

function stored(provider) {
  if (memo.has(provider)) return memo.get(provider);
  let key = null;
  if (where() === "keychain") {
    const r = spawnSync("security", ["find-generic-password", "-s", SERVICE, "-a", provider, "-w"], { encoding: "utf8" });
    if (r.status === 0) key = r.stdout.trim() || null;
  } else {
    key = readJson(FILE)[provider] || null;
  }
  memo.set(provider, key);
  return key;
}

// The key to use for a provider, and where it comes from.
export function keyFor(provider) {
  const key = stored(provider);
  if (key) return { key, source: where() };
  if (process.env[ENV[provider]]) return { key: process.env[ENV[provider]], source: "env" };
  return null;
}

// What the page may know: the provider, the model, whether there's a key and where it lives. Never the key.
export function status(defaults) {
  const s = readJson(SETTINGS);
  let provider = s.provider;
  if (!provider) provider = keyFor("claude") ? "claude" : keyFor("openai") ? "openai" : "claude";
  const found = keyFor(provider);
  return {
    provider,
    model: s.model && s.provider === provider ? s.model : defaults[provider].model,
    hasKey: !!found,
    source: found?.source || null,
    env: ENV[provider],
    where: where(),
  };
}

export function save(provider, model, key) {
  if (!ENV[provider]) throw new Error("Unknown provider.");
  if (key) {
    if (!/^[\w.:-]+$/.test(key)) throw new Error("That doesn't look like an API key.");
    if (where() === "keychain") {
      // Through `security -i` (stdin), so the key never shows in the process list.
      const r = spawnSync("security", ["-i"], {
        input: `add-generic-password -U -s ${SERVICE} -a ${provider} -l "Repo Atlas (${provider})" -w "${key}"\n`,
        encoding: "utf8",
      });
      if (r.status !== 0 || /error/i.test(r.stderr || "")) throw new Error("The keychain didn't take the key.");
    } else {
      writeJson(FILE, { ...readJson(FILE), [provider]: key });
    }
    memo.set(provider, key);
  }
  if (!keyFor(provider)) throw new Error("Paste a key first.");
  writeJson(SETTINGS, { provider, model });
}

export function remove(provider) {
  if (where() === "keychain") spawnSync("security", ["delete-generic-password", "-s", SERVICE, "-a", provider], { encoding: "utf8" });
  else {
    const keys = readJson(FILE);
    delete keys[provider];
    writeJson(FILE, keys);
  }
  memo.set(provider, null);
}
