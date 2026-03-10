/**
 * yt-dlp utility
 * - extract()         → metadata + format URLs (for /extract endpoint)
 * - downloadMerged()  → downloads video+audio, merges with ffmpeg, returns tmp file path
 */

"use strict";

const { spawn, spawnSync } = require("child_process");
const path   = require("path");
const fs     = require("fs");
const os     = require("os");
const crypto = require("crypto");

// ─── Paths ────────────────────────────────────────────────────────────────────

const BIN_DIR      = path.join(__dirname, "..", "bin");
const LOCAL_BINARY = os.platform() === "win32"
  ? path.join(BIN_DIR, "yt-dlp.exe")
  : path.join(BIN_DIR, "yt-dlp");

const TMP_DIR = path.join(os.tmpdir(), "snapload_dl");
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolveYtDlpPath() {
  if (fs.existsSync(LOCAL_BINARY)) return LOCAL_BINARY;
  try {
    const r = spawnSync(os.platform() === "win32" ? "where" : "which", ["yt-dlp"], { stdio: "pipe" });
    if (r.status === 0 && r.stdout.toString().trim()) return "yt-dlp";
  } catch (_) {}
  return null;
}

function hasFfmpeg() {
  try { return spawnSync("ffmpeg", ["-version"], { stdio: "pipe" }).status === 0; }
  catch (_) { return false; }
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com"))                               return "tiktok";
  if (u.includes("instagram.com"))                            return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.watch"))  return "facebook";
  if (u.includes("youtube.com") || u.includes("youtu.be") || u.includes("youtube-nocookie.com"))
    return u.includes("list=") ? "youtube_playlist" : "youtube";
  return "unknown";
}

function validateUrl(url) {
  try { const p = new URL(url); return ["http:", "https:"].includes(p.protocol); }
  catch (_) { return false; }
}

// ─── Per-platform extra args ──────────────────────────────────────────────────

const PLATFORM_EXTRA = {
  tiktok: [
    "--extractor-args", "tiktok:api_hostname=api16-normal-c-useast1a.tiktokv.com",
    "--add-header", "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
  ],
  instagram: [
    "--add-header", "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
    "--add-header", "Referer:https://www.instagram.com/",
  ],
  facebook: [
    "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  ],
  youtube: [],
  unknown: [],
};

const BASE_ARGS = [
  "--no-playlist",
  "--no-warnings",
  "--geo-bypass",
  "--geo-bypass-country", "US",
  "--socket-timeout",     "30",
  "--retries",            "5",
  "--fragment-retries",   "5",
  "--add-header",         "Accept-Language:en-US,en;q=0.9",
];

// Best format: prefer H264+AAC mp4 (widest browser support), fallback to anything merged
const FORMAT_BEST = [
  "bestvideo[ext=mp4][vcodec^=avc1]+bestaudio[ext=m4a]",
  "bestvideo[ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]",
  "bestvideo[ext=mp4]+bestaudio[ext=m4a]",
  "bestvideo[ext=mp4]+bestaudio",
  "bestvideo+bestaudio[ext=m4a]",
  "bestvideo+bestaudio",
  "best[ext=mp4]",
  "best",
].join("/");

// ─── Error parser ─────────────────────────────────────────────────────────────

function parseError(raw) {
  const t = (raw || "").toLowerCase();
  if (t.includes("unsupported url"))                                       return "Unsupported URL. Paste a direct video/reel link.";
  if (t.includes("private video") || t.includes("this video is private")) return "This video is private.";
  if (t.includes("login") && t.includes("required"))                      return "Login required. This content needs authentication.";
  if (t.includes("age") && t.includes("restrict"))                        return "Age-restricted content.";
  if (t.includes("429") || t.includes("too many requests"))               return "Rate limited by platform. Wait a few minutes and retry.";
  if (t.includes("404") || t.includes("not found"))                       return "Video not found — may have been deleted.";
  if (t.includes("403") || t.includes("forbidden"))                       return "Access denied by platform.";
  if (t.includes("removed") || t.includes("deleted"))                     return "This video has been removed.";
  if (t.includes("not available in your country"))                        return "Geo-restricted content.";
  if (t.includes("instagram") && t.includes("not available"))            return "Instagram blocked this request. Try a different URL.";
  const line = (raw || "").split("\n").find(l => l.trim() && !l.startsWith("WARNING") && !l.startsWith("NOTE")) || raw;
  return (line || "Unknown error").trim().substring(0, 300);
}

// ─── runYtDlp() ───────────────────────────────────────────────────────────────

function runYtDlp(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let stdout = "", stderr = "";
    const proc = spawn(bin, args, {
      shell: false,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", d => { stdout += d; });
    proc.stderr.on("data", d => { stderr += d; });
    const timer = setTimeout(() => { proc.kill("SIGTERM"); reject({ stderr: "Timed out.", stdout: "" }); }, timeoutMs);
    proc.on("close", code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject({ stderr, stdout }); });
    proc.on("error", err  => { clearTimeout(timer); reject({ stderr: err.message, stdout: "" }); });
  });
}

// ─── 1. extract() — metadata only ────────────────────────────────────────────

function extract(url) {
  return new Promise((resolve, reject) => {
    if (!validateUrl(url)) return reject(new Error("Invalid URL."));
    const platform = detectPlatform(url);
    const bin      = resolveYtDlpPath();
    if (!bin) return reject(new Error("yt-dlp not found. Run: npm run setup"));

    if (platform === "youtube_playlist") {
      const args = [
        "--yes-playlist", "--flat-playlist", "--dump-single-json",
        "--no-warnings", "--quiet", "--geo-bypass", "--socket-timeout", "30", url,
      ];
      return runYtDlp(bin, args, 60_000)
        .then(out => resolve(formatPlaylist(JSON.parse(out.trim()))))
        .catch(e  => reject(new Error(parseError(e.stderr || e.stdout))));
    }

    const args = [...BASE_ARGS, "--dump-json", "--quiet", ...(PLATFORM_EXTRA[platform] || []), url];
    runYtDlp(bin, args, 60_000)
      .then(out => {
        const lines = out.trim().split("\n").filter(Boolean);
        resolve(formatResponse(JSON.parse(lines[lines.length - 1]), platform));
      })
      .catch(e => reject(new Error(parseError(e.stderr || e.stdout))));
  });
}

// ─── 2. downloadMerged() — actual download + merge → file on disk ─────────────

function downloadMerged(url, quality) {
  return new Promise((resolve, reject) => {
    if (!validateUrl(url)) return reject(new Error("Invalid URL."));
    const platform = detectPlatform(url);
    const bin      = resolveYtDlpPath();
    if (!bin) return reject(new Error("yt-dlp not found. Run: npm run setup"));

    const id      = crypto.randomBytes(10).toString("hex");
    const outTpl  = path.join(TMP_DIR, `${id}.%(ext)s`);

    // Pick format based on quality param
    let fmt;
    if (quality === "audio") {
      fmt = "bestaudio[ext=m4a]/bestaudio[ext=mp3]/bestaudio/best";
    } else if (quality === "360p") {
      fmt = "bestvideo[height<=360][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[height<=360]+bestaudio/best[height<=360]/best";
    } else if (quality === "720p") {
      fmt = "bestvideo[height<=720][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best";
    } else if (quality === "1080p") {
      fmt = "bestvideo[height<=1080][ext=mp4][vcodec^=avc]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best";
    } else {
      fmt = FORMAT_BEST;
    }

    const ffmpeg = hasFfmpeg();
    console.log(`[dl] ffmpeg available: ${ffmpeg}`);

    const args = [
      ...BASE_ARGS,
      "--format",  fmt,
      "--output",  outTpl,
      "--quiet",
      "--no-simulate",
      "--print",   "after_move:filepath",
    ];

    if (ffmpeg) {
      args.push("--merge-output-format", "mp4");
    } else {
      // No ffmpeg — force pre-merged single-file format
      args[args.indexOf("--format") + 1] =
        "best[ext=mp4]/best[vcodec^=avc1]/best[vcodec^=avc]/best";
    }

    args.push(...(PLATFORM_EXTRA[platform] || []), url);

    console.log(`[dl] Downloading: ${url} quality=${quality || "best"}`);

    runYtDlp(bin, args, 300_000)
      .then(out => {
        // --print after_move:filepath gives us the final path
        const lines    = out.trim().split("\n").filter(Boolean);
        let   filePath = lines[lines.length - 1].trim();

        // Fallback: scan TMP_DIR for our file
        if (!filePath || !fs.existsSync(filePath)) {
          const found = fs.readdirSync(TMP_DIR)
            .filter(f => f.startsWith(id))
            .map(f => path.join(TMP_DIR, f))
            .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
          if (!found.length) return reject(new Error("Download completed but file not found on server."));
          filePath = found[0];
        }

        const ext      = path.extname(filePath).slice(1) || "mp4";
        const isAudio  = quality === "audio";
        const mimeType = isAudio ? "audio/mp4" : "video/mp4";
        const sizeMB   = (fs.statSync(filePath).size / 1e6).toFixed(1);
        console.log(`[dl] Ready: ${filePath} (${sizeMB} MB)`);

        const cleanup = () => {
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
        };

        resolve({ filePath, filename: `download.${ext}`, mimeType, cleanup });
      })
      .catch(e => reject(new Error(parseError(e.stderr || e.stdout))));
  });
}

// ─── Response formatters ──────────────────────────────────────────────────────

function formatResponse(raw, platform) {
  const formats = (raw.formats || [])
    .filter(f => f.url && (f.vcodec !== "none" || f.acodec !== "none"))
    .map(f => ({
      format_id:  f.format_id,
      ext:        f.ext,
      quality:    f.quality,
      resolution: f.resolution || (f.height ? `${f.width || "?"}x${f.height}` : null),
      fps:        f.fps || null,
      filesize:   f.filesize || f.filesize_approx || null,
      vcodec:     f.vcodec !== "none" ? f.vcodec : null,
      acodec:     f.acodec !== "none" ? f.acodec : null,
      url:        f.url,
      has_video:  !!(f.vcodec && f.vcodec !== "none"),
      has_audio:  !!(f.acodec && f.acodec !== "none"),
    }))
    .sort((a, b) => (b.quality || 0) - (a.quality || 0));

  const bestCombined = formats.find(f => f.has_video && f.has_audio);
  const bestVideo    = formats.find(f => f.has_video);
  const bestAudio    = formats.find(f => f.has_audio && !f.has_video);

  return {
    platform,
    type:            raw.is_live ? "live" : raw._type || "video",
    id:              raw.id,
    title:           raw.title || "Untitled",
    description:     raw.description ? raw.description.substring(0, 500) : null,
    uploader:        raw.uploader || raw.creator || raw.channel || null,
    uploader_url:    raw.uploader_url || raw.channel_url || null,
    duration:        raw.duration || null,
    duration_string: raw.duration_string || null,
    view_count:      raw.view_count || null,
    like_count:      raw.like_count || null,
    comment_count:   raw.comment_count || null,
    upload_date:     raw.upload_date
      ? `${raw.upload_date.slice(0,4)}-${raw.upload_date.slice(4,6)}-${raw.upload_date.slice(6,8)}`
      : null,
    webpage_url:   raw.webpage_url || raw.original_url,
    thumbnail:     raw.thumbnail   || raw.thumbnails?.[0]?.url || null,
    thumbnails:    (raw.thumbnails || []).slice(-3).map(t => ({ url: t.url, width: t.width || null, height: t.height || null })),
    download: {
      best:       bestCombined?.url || bestVideo?.url || null,
      best_audio: bestAudio?.url    || null,
      direct_url: raw.url           || null,
    },
    formats_count:        formats.length,
    formats,
    has_separate_streams: !bestCombined && !!(bestVideo && bestAudio),
  };
}

function formatPlaylist(raw) {
  return {
    platform:    "youtube_playlist",
    type:        "playlist",
    id:          raw.id,
    title:       raw.title || "Untitled Playlist",
    description: raw.description || null,
    uploader:    raw.uploader || raw.channel || null,
    url:         raw.webpage_url || raw.original_url,
    thumbnail:   raw.thumbnails?.[0]?.url || null,
    entry_count: raw.playlist_count || raw.entries?.length || 0,
    entries:     (raw.entries || []).map(e => ({
      id:        e.id,
      title:     e.title,
      url:       e.url || `https://www.youtube.com/watch?v=${e.id}`,
      duration:  e.duration || null,
      thumbnail: e.thumbnails?.[0]?.url || null,
    })),
  };
}

// ─── Auto-cleanup tmp files older than 1h ────────────────────────────────────
setInterval(() => {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    fs.readdirSync(TMP_DIR).forEach(f => {
      const fp = path.join(TMP_DIR, f);
      if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
    });
  } catch (_) {}
}, 15 * 60 * 1000);

module.exports = { extract, downloadMerged, detectPlatform, validateUrl, resolveYtDlpPath, hasFfmpeg };
