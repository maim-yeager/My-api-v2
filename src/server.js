/**
 * Social Media Downloader API
 * ─────────────────────────────────────────────────────────────────────────────
 * Express server with yt-dlp backend.
 * Supports: YouTube, YouTube Playlist, TikTok, Instagram, Facebook
 *
 * Start: node src/server.js
 * Dev:   npm run dev
 */

"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");
const os = require("os");

const routes = require("./routes");

// ─── Config ──────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const NODE_ENV = process.env.NODE_ENV || "development";
const IS_DEV = NODE_ENV !== "production";

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();

// Trust proxy — required for rate limiter to work correctly behind Nginx/Render/etc.
// Set to 1 hop; safe on localhost too.
app.set("trust proxy", 1);

// ─── Security Headers ────────────────────────────────────────────────────────

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ─── CORS ────────────────────────────────────────────────────────────────────

app.use(
  cors({
    origin: "*", // Allow all origins (adjust in production as needed)
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    optionsSuccessStatus: 204,
  })
);

// Pre-flight
app.options("*", cors());

// ─── Request Parsing ─────────────────────────────────────────────────────────

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ─── Logging ─────────────────────────────────────────────────────────────────

app.use(
  morgan(IS_DEV ? "dev" : "combined", {
    skip: (req) => req.path === "/health",
  })
);

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Generous limits — the real bottleneck is yt-dlp extraction time.

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many requests. Please wait a few minutes before trying again.",
  },
  // Skip rate limiting for localhost in dev mode
  skip: (req) => {
    if (!IS_DEV) return false;
    const ip = req.ip || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
});

const extractLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many extraction requests. Limit is 20 per minute.",
  },
  skip: (req) => {
    if (!IS_DEV) return false;
    const ip = req.ip || "";
    return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  },
});

app.use(globalLimiter);
app.use("/extract", extractLimiter);
app.use("/info", extractLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────

app.use("/", routes);

// ─── 404 Handler ─────────────────────────────────────────────────────────────

app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Route not found: ${req.method} ${req.path}`,
    available_routes: ["GET /", "GET /health", "POST /extract", "POST /info"],
  });
});

// ─── Global Error Handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error("[error]", err.message);
  if (IS_DEV) console.error(err.stack);

  res.status(err.status || 500).json({
    success: false,
    error: IS_DEV ? err.message : "Internal server error",
  });
});

// ─── Auto-run setup if yt-dlp missing ────────────────────────────────────────

async function ensureYtDlp() {
  const { resolveYtDlpPath } = require("./ytdlp");
  const ytDlpPath = resolveYtDlpPath();

  if (!ytDlpPath) {
    console.warn("\n⚠️  yt-dlp not found. Attempting auto-install...");
    try {
      // Dynamically run the setup logic inline (non-crashing)
      const { execSync, spawnSync } = require("child_process");
      const pipCmds = ["pip3", "pip"];
      let installed = false;

      for (const pip of pipCmds) {
        if (!installed) {
          for (const flag of ["--break-system-packages", "--user", ""]) {
            try {
              const cmd = `${pip} install yt-dlp --quiet ${flag}`.trim();
              execSync(cmd, { stdio: "pipe", shell: true, timeout: 60000 });
              console.log(`✓  yt-dlp installed via: ${cmd}`);
              installed = true;
              break;
            } catch (_) {}
          }
        }
      }

      if (!installed) {
        console.warn("⚠️  Could not install yt-dlp via pip.");
        console.warn("   Extraction requests will fail until yt-dlp is installed.");
        console.warn("   On Render: add 'pip install yt-dlp' to your Build Command.");
      }
    } catch (e) {
      console.warn("⚠️  yt-dlp auto-install failed:", e.message);
    }
  } else {
    console.log(`✓  yt-dlp found: ${ytDlpPath}`);
  }
}

// ─── Start Server ─────────────────────────────────────────────────────────────

async function start() {
  await ensureYtDlp();

  app.listen(PORT, HOST, () => {
    const localUrl = `http://localhost:${PORT}`;
    const networkUrl = `http://${getLocalIP()}:${PORT}`;

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("  🎬  Social Media Downloader API");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(`  Local:    ${localUrl}`);
    console.log(`  Network:  ${networkUrl}`);
    console.log(`  Health:   ${localUrl}/health`);
    console.log(`  Env:      ${NODE_ENV}`);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("\n  Endpoints:");
    console.log(`  GET  ${localUrl}/`);
    console.log(`  GET  ${localUrl}/health`);
    console.log(`  POST ${localUrl}/extract  { "url": "VIDEO_URL" }`);
    console.log("\n  Ready to receive requests ✓\n");
  });
}

function getLocalIP() {
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === "IPv4" && !iface.internal) {
          return iface.address;
        }
      }
    }
  } catch (_) {}
  return "localhost";
}

start().catch((err) => {
  console.error("Failed to start server:", err.message);
  // Do NOT process.exit(1) — Render will mark it as "exited early"
  // Instead log the error and let Node exit naturally only if truly unrecoverable
});

module.exports = app; // For testing
