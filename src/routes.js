/**
 * API Routes
 *
 * GET  /health          → server + yt-dlp status
 * POST /extract         → metadata only (fast)
 * GET  /download?url=&quality=  → download merged mp4 with audio (streams file)
 */

"use strict";

const express = require("express");
const fs      = require("fs");
const path    = require("path");
const { extract, downloadMerged, detectPlatform, resolveYtDlpPath, hasFfmpeg } = require("./ytdlp");

const router = express.Router();

// ─── GET /health ──────────────────────────────────────────────────────────────

router.get("/health", (req, res) => {
  const ytDlpPath = resolveYtDlpPath();
  const ffmpeg    = hasFfmpeg();
  res.status(200).json({
    success:  true,
    message:  "API is running",
    timestamp: new Date().toISOString(),
    yt_dlp: ytDlpPath
      ? { available: true,  path: ytDlpPath }
      : { available: false, path: null, hint: "Run: npm run setup  or  pip install yt-dlp" },
    ffmpeg: {
      available: ffmpeg,
      note: ffmpeg ? "Audio+video merging enabled" : "ffmpeg not found — audio merging disabled. Install: apt install ffmpeg",
    },
    supported_platforms: ["youtube", "youtube_playlist", "tiktok", "instagram", "facebook"],
  });
});

// ─── POST /extract — metadata only ───────────────────────────────────────────

router.post("/extract", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ success: false, error: 'Missing "url" in request body.' });
  }
  const trimmed  = url.trim();
  const platform = detectPlatform(trimmed);
  try {
    const data = await extract(trimmed);
    return res.status(200).json({ success: true, platform, data });
  } catch (err) {
    return res.status(422).json({ success: false, platform, error: err.message });
  }
});

// Alias
router.post("/info", async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ success: false, error: 'Missing "url" in request body.' });
  }
  const trimmed  = url.trim();
  const platform = detectPlatform(trimmed);
  try {
    const data = await extract(trimmed);
    return res.status(200).json({ success: true, platform, data });
  } catch (err) {
    return res.status(422).json({ success: false, platform, error: err.message });
  }
});

// ─── GET /download — actual merged file download ──────────────────────────────
//
//  Query params:
//    url      (required) — video URL
//    quality  (optional) — best | 360p | 720p | 1080p | audio   (default: best)
//
//  Returns: streaming mp4 (or m4a for audio) with Content-Disposition header

router.get("/download", async (req, res) => {
  const { url, quality } = req.query;

  if (!url || typeof url !== "string" || !url.trim()) {
    return res.status(400).json({ success: false, error: 'Missing "url" query parameter.' });
  }

  const validQualities = ["best", "360p", "720p", "1080p", "audio"];
  const q = validQualities.includes(quality) ? quality : "best";

  console.log(`[/download] url=${url} quality=${q}`);

  let result;
  try {
    result = await downloadMerged(url.trim(), q);
  } catch (err) {
    return res.status(422).json({ success: false, error: err.message });
  }

  const { filePath, filename, mimeType, cleanup } = result;

  if (!fs.existsSync(filePath)) {
    return res.status(500).json({ success: false, error: "File not found after download." });
  }

  const stat = fs.statSync(filePath);
  res.setHeader("Content-Type",        mimeType);
  res.setHeader("Content-Length",      stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control",       "no-cache");

  const stream = fs.createReadStream(filePath);
  stream.pipe(res);
  stream.on("end",   () => { cleanup(); });
  stream.on("error", (err) => {
    console.error("[stream error]", err.message);
    cleanup();
    if (!res.headersSent) res.status(500).json({ success: false, error: "Stream error." });
  });

  req.on("close", () => {
    // Client disconnected — clean up
    stream.destroy();
    cleanup();
  });
});

// ─── GET / — API docs ─────────────────────────────────────────────────────────

router.get("/", (req, res) => {
  res.status(200).json({
    name:    "Social Media Downloader API",
    version: "2.0.0",
    status:  "running",
    endpoints: [
      { method: "GET",  path: "/health",                           description: "Health check" },
      { method: "POST", path: "/extract",    body: { url: "string" }, description: "Get metadata + format list (fast, no download)" },
      { method: "GET",  path: "/download",   query: { url: "string", quality: "best|360p|720p|1080p|audio" }, description: "Download merged mp4 with audio (streams file)" },
    ],
    notes: [
      "Use /download for actual files with audio — /extract returns raw CDN URLs which may lack audio on YouTube.",
      "ffmpeg must be installed on the server for audio+video merging.",
    ],
  });
});

module.exports = router;
