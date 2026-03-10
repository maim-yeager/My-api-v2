# 🎬 Social Media Downloader API

A production-ready REST API for extracting media metadata and direct download links from **YouTube, TikTok, Instagram, and Facebook** — powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp).

---

## ✨ Features

- 📺 **YouTube** — single videos + full playlists
- 🎵 **TikTok** — video + audio
- 📸 **Instagram** — posts, reels, stories
- 👥 **Facebook** — videos and reels
- ⚡ Returns direct download URLs, metadata, thumbnails, and all available formats
- 🔒 CORS-enabled, rate-limited, helmet-secured
- 🚫 No API keys needed
- 🩺 `/health` endpoint for uptime checks

---

## 🚀 Quick Start

### 1. Install Node.js dependencies

```bash
npm install
```

### 2. Install yt-dlp

**Option A — automatic (recommended):**
```bash
npm run setup
```

**Option B — via pip:**
```bash
pip install yt-dlp
# or
pip3 install yt-dlp
```

**Option C — manual binary (no Python needed):**
Download the binary from [yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases) and place it in the `bin/` folder.

### 3. Start the server

```bash
npm start
```

The server starts on **http://localhost:3000** ✓

For development with auto-reload:
```bash
npm run dev
```

---

## 📡 API Endpoints

### `GET /health`

Health check — confirms the API and yt-dlp are working.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "success": true,
  "message": "API is running",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "yt_dlp": { "available": true, "path": "/usr/local/bin/yt-dlp" },
  "supported_platforms": ["youtube", "youtube_playlist", "tiktok", "instagram", "facebook"]
}
```

---

### `POST /extract`

Extract media information and download links from any supported URL.

**Request:**
```bash
curl -X POST http://localhost:3000/extract \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}'
```

**Successful Response:**
```json
{
  "success": true,
  "platform": "youtube",
  "data": {
    "id": "dQw4w9WgXcQ",
    "title": "Rick Astley - Never Gonna Give You Up",
    "uploader": "Rick Astley",
    "duration": 212,
    "duration_string": "3:32",
    "view_count": 1400000000,
    "upload_date": "2009-10-25",
    "thumbnail": "https://...",
    "download": {
      "best": "https://...",
      "best_audio": "https://..."
    },
    "formats_count": 18,
    "formats": [...]
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "platform": "youtube",
  "error": "This video is private and cannot be accessed."
}
```

---

### `POST /info`

Alias for `/extract` — identical behavior.

---

### `GET /`

Returns full API documentation in JSON.

---

## 🌐 Supported Platforms & URL Examples

| Platform | Example URL |
|---|---|
| YouTube | `https://www.youtube.com/watch?v=VIDEO_ID` |
| YouTube Short | `https://youtu.be/VIDEO_ID` |
| YouTube Playlist | `https://www.youtube.com/playlist?list=PLAYLIST_ID` |
| TikTok | `https://www.tiktok.com/@user/video/VIDEO_ID` |
| Instagram Post | `https://www.instagram.com/p/CODE/` |
| Instagram Reel | `https://www.instagram.com/reel/CODE/` |
| Instagram Story | `https://www.instagram.com/stories/user/ID/` |
| Facebook Video | `https://www.facebook.com/watch?v=VIDEO_ID` |
| Facebook Reel | `https://www.facebook.com/reel/VIDEO_ID` |

---

## ⚙️ Configuration

All config is optional. Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `development` | Environment mode |

---

## 🔁 Keeping yt-dlp Updated

Social media platforms frequently change their APIs. Keep yt-dlp updated for best results:

```bash
pip install -U yt-dlp
# or
yt-dlp -U
```

---

## 📦 Project Structure

```
social-media-downloader-api/
├── src/
│   ├── server.js     # Express app & server bootstrap
│   ├── routes.js     # API route handlers
│   ├── ytdlp.js      # yt-dlp wrapper & response formatter
│   └── setup.js      # Auto-installer for yt-dlp
├── bin/              # Local yt-dlp binary (auto-created)
├── package.json
├── .env.example
└── README.md
```

---

## 🛠️ Troubleshooting

**yt-dlp not found:**
```bash
npm run setup
# or
pip install yt-dlp
```

**Extraction fails / "Video unavailable":**
- The video may be private, deleted, or geo-restricted
- Update yt-dlp: `pip install -U yt-dlp`
- Some Instagram/TikTok content requires a logged-in session (not supported by this API without cookies)

**Rate limit errors from platforms:**
- Add a delay between requests
- The API will return a clear error message

---

## 📄 License

MIT
