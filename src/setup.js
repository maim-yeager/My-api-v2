/**
 * Setup Script — installs yt-dlp automatically if not present.
 * Run: node src/setup.js
 */

const { execSync, spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");

const BIN_DIR = path.join(__dirname, "..", "bin");
const YT_DLP_BINARY =
  os.platform() === "win32"
    ? path.join(BIN_DIR, "yt-dlp.exe")
    : path.join(BIN_DIR, "yt-dlp");

function log(msg) {
  console.log(`[setup] ${msg}`);
}

function ensureBinDir() {
  if (!fs.existsSync(BIN_DIR)) {
    fs.mkdirSync(BIN_DIR, { recursive: true });
    log(`Created bin directory: ${BIN_DIR}`);
  }
}

function checkCommand(cmd) {
  const result = spawnSync(cmd, ["--version"], {
    stdio: "pipe",
    shell: os.platform() === "win32",
  });
  return result.status === 0;
}

function installViaPip() {
  log("Attempting yt-dlp install via pip...");
  const pipCommands = ["pip3", "pip"];
  for (const pip of pipCommands) {
    if (checkCommand(pip)) {
      // Try multiple install strategies in order
      const strategies = [
        `${pip} install yt-dlp --quiet --break-system-packages`,
        `${pip} install yt-dlp --quiet --user`,
        `${pip} install yt-dlp --quiet`,
      ];
      for (const cmd of strategies) {
        try {
          execSync(cmd, { stdio: "pipe", shell: true });
          log(`yt-dlp installed via: ${cmd}`);
          return true;
        } catch (e) {
          log(`Strategy failed (${cmd}): ${e.message.split("\n")[0]}`);
        }
      }
    }
  }
  return false;
}

function downloadBinaryDirect() {
  const platform = os.platform();
  const arch = os.arch();
  log(`Downloading yt-dlp binary for ${platform}/${arch}...`);

  let url;
  if (platform === "linux" && arch === "x64") {
    url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
  } else if (platform === "linux" && arch === "arm64") {
    url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64";
  } else if (platform === "darwin") {
    url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
  } else if (platform === "win32") {
    url = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
  } else {
    log("Unsupported platform for direct binary download.");
    return false;
  }

  try {
    // Try curl first, then wget
    const curlCmd = `curl -L "${url}" -o "${YT_DLP_BINARY}" --progress-bar`;
    const wgetCmd = `wget -q "${url}" -O "${YT_DLP_BINARY}"`;

    if (checkCommand("curl")) {
      execSync(curlCmd, { stdio: "inherit", shell: true });
    } else if (checkCommand("wget")) {
      execSync(wgetCmd, { stdio: "inherit", shell: true });
    } else {
      log("Neither curl nor wget found. Cannot download binary.");
      return false;
    }

    if (platform !== "win32") {
      fs.chmodSync(YT_DLP_BINARY, 0o755);
    }
    log(`yt-dlp binary saved to ${YT_DLP_BINARY}`);
    return true;
  } catch (e) {
    log(`Direct download failed: ${e.message}`);
    return false;
  }
}

async function setup() {
  log("Starting setup...");
  ensureBinDir();

  // 1. Check if yt-dlp is already in PATH
  if (checkCommand("yt-dlp")) {
    log("yt-dlp is already installed and available in PATH. ✓");
    return;
  }

  // 2. Check if local binary exists
  if (fs.existsSync(YT_DLP_BINARY)) {
    log(`Local yt-dlp binary found at ${YT_DLP_BINARY}. ✓`);
    return;
  }

  log("yt-dlp not found. Installing...");

  // 3. Try pip install
  if (installViaPip()) {
    if (checkCommand("yt-dlp")) {
      log("yt-dlp is now available via pip install. ✓");
      return;
    }
  }

  // 4. Fallback: direct binary download
  if (downloadBinaryDirect()) {
    log("yt-dlp binary downloaded successfully. ✓");
    return;
  }

  log("WARNING: Could not install yt-dlp automatically.");
  log("Please install manually: pip install yt-dlp");
  log("Or download from: https://github.com/yt-dlp/yt-dlp/releases");
}

setup().catch((e) => {
  log(`Setup encountered an error: ${e.message}`);
  // Never crash — server will still start and show a clear error on /health
}).finally(() => {
  // Ensure postinstall never hangs the npm install process
  if (require.main === module) process.exit(0);
});

module.exports = { YT_DLP_BINARY, BIN_DIR };
