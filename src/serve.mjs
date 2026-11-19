// `atlas serve`: a local server, so the map can switch projects. It lists the folders of one parent folder
// (~/Code, say), maps the one you pick on the fly, and on a Mac opens Finder's folder chooser for any other.
// It listens on 127.0.0.1 only: your code never leaves this computer.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile, execFileSync } from "node:child_process";
import { scan } from "./scan.mjs";
import { escapeHtml, renderMap } from "./render.mjs";
import { keyFor, remove, save, status } from "./keys.mjs";
import { PROVIDERS, summarize } from "./viewer/ai.js";

const SKIP = new Set(["node_modules", ".git", ".Trash"]);

export function serve({ root, port = 4317, open = false, source = true }) {
  root = path.resolve(root);
  const browse = process.platform === "darwin";

  // The folders in root, most recently changed first (last commit, or last modified when it isn't a git repo).
  const projects = () => {
    const out = [];
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith(".") || SKIP.has(e.name)) continue;
      const dir = path.join(root, e.name);
      const git = fs.existsSync(path.join(dir, ".git"));
      let last = 0;
      if (git) {
        try { last = +execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || 0; } catch {}
      }
      if (!last) last = Math.floor(fs.statSync(dir).mtimeMs / 1000);
      out.push({ name: e.name, path: dir, git, last });
    }
    return out.sort((a, b) => b.last - a.last);
  };

  const send = (res, status, type, body) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const page = (res, status, title, text) => send(res, status, "text/html; charset=utf-8",
    `<!doctype html><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<body style="font:15px/1.5 system-ui;margin:48px;max-width:560px"><h1 style="font-weight:500">${escapeHtml(title)}</h1><p>${text}</p><p><a href="/">Back to the map</a></p>`);

  // The AI routes answer this server's own pages only: other sites can't send the X-Atlas header without a
  // preflight we never approve, and their Origin wouldn't match.
  const ours = (req) => {
    const o = req.headers.origin;
    return req.headers["x-atlas"] === "1" && (!o || o === `http://localhost:${port}` || o === `http://127.0.0.1:${port}`);
  };
  const json = (res, code, value) => send(res, code, "application/json", JSON.stringify(value));
  const body = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 2_000_000) { reject(new Error("Too large.")); req.destroy(); } else chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch { reject(new Error("Not JSON.")); }
    });
  });

  const ai = async (req, res, url) => {
    if (!ours(req)) return json(res, 403, { error: "Only repo atlas's own pages can do that." });
    if (url.pathname === "/api/ai" && req.method === "GET") return json(res, 200, status(PROVIDERS));
    if (url.pathname === "/api/ai" && req.method === "POST") {
      const { provider, model, key } = await body(req);
      try {
        save(provider, model || PROVIDERS[provider]?.model, (key || "").trim());
      } catch (e) {
        return json(res, 400, { error: e.message });
      }
      return json(res, 200, status(PROVIDERS));
    }
    if (url.pathname === "/api/ai" && req.method === "DELETE") {
      remove(status(PROVIDERS).provider);
      return json(res, 200, status(PROVIDERS));
    }
    if (url.pathname === "/api/summarize" && req.method === "POST") {
      const { prompt } = await body(req);
      const s = status(PROVIDERS);
      const found = keyFor(s.provider);
      if (!found) return json(res, 400, { error: "Add a key first." });
      try {
        return json(res, 200, await summarize({ provider: s.provider, model: s.model, key: found.key }, String(prompt || "")));
      } catch (e) {
        return json(res, 502, { error: e instanceof TypeError ? `Couldn't reach ${PROVIDERS[s.provider].name}. Check your connection.` : e.message });
      }
    }
    return json(res, 404, { error: "Not found" });
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    try {
      if (url.pathname === "/api/ai" || url.pathname === "/api/summarize") return await ai(req, res, url);
      if (url.pathname === "/") {
        const first = projects()[0];
        if (!first) return page(res, 200, "No projects here", `There are no folders in ${escapeHtml(root)}. Start atlas with another folder: <code>atlas serve ~/Code</code>.`);
        res.writeHead(302, { location: `/map?path=${encodeURIComponent(first.path)}` });
        return res.end();
      }
      if (url.pathname === "/api/projects") {
        return send(res, 200, "application/json", JSON.stringify({ root, projects: projects() }));
      }
      if (url.pathname === "/api/browse") {
        if (!browse) return send(res, 501, "application/json", JSON.stringify({ error: "Only on a Mac" }));
        // Finder's folder chooser, shown over the browser (the frontmost app).
        const script = 'tell application (path to frontmost application as text) to POSIX path of (choose folder with prompt "Pick a folder to map")';
        const done = (stdout) => send(res, 200, "application/json", JSON.stringify({ path: stdout.trim().replace(/\/$/, "") }));
        const cancelled = (stderr) => /-128/.test(stderr || "");
        execFile("osascript", ["-e", script], (err, stdout, stderr) => {
          if (!err) return done(stdout);
          if (cancelled(stderr)) return send(res, 200, "application/json", JSON.stringify({ cancelled: true }));
          // Some apps don't take the command: ask from osascript itself.
          execFile("osascript", ["-e", 'POSIX path of (choose folder with prompt "Pick a folder to map")'], (err2, out2, stderr2) => {
            if (!err2) return done(out2);
            send(res, 200, "application/json", JSON.stringify(cancelled(stderr2) ? { cancelled: true } : { error: "Finder's folder chooser didn't open" }));
          });
        });
        return;
      }
      if (url.pathname === "/map") {
        const dir = path.resolve((url.searchParams.get("path") || "").replace(/^~(?=\/|$)/, process.env.HOME || "~"));
        if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return page(res, 404, "Folder not found", `There's no folder at ${escapeHtml(dir)}.`);
        }
        const t0 = Date.now();
        const data = scan(dir, { source });
        console.log(`${data.name}: ${data.files.length} files mapped in ${Date.now() - t0} ms`);
        return send(res, 200, "text/html; charset=utf-8", renderMap(data, { server: { root, browse, current: dir } }));
      }
      page(res, 404, "Not found", "");
    } catch (e) {
      console.error(e);
      page(res, 500, "Something went wrong", escapeHtml(e.message));
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://localhost:${port}/`;
    console.log(`Repo atlas: ${url}  (projects from ${root})`);
    if (open) {
      const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      execFile(opener, [url], () => {});
    }
  });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") console.error(`Port ${port} is busy: try --port ${port + 1}`);
    else console.error(e.message);
    process.exit(1);
  });
}
