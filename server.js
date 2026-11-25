require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStoreFactory = require("connect-sqlite3");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const OUTPUT_DIR = path.join(DATA_DIR, "clips");
for (const dir of [DATA_DIR, UPLOAD_DIR, OUTPUT_DIR]) fs.mkdirSync(dir, { recursive: true });

const db = new Database(path.join(DATA_DIR, "clipforge.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS clips (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL,
 filename TEXT NOT NULL,
 original_name TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const SQLiteStore = SQLiteStoreFactory(session);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "replace-this-before-deployment",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 7 * 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(ROOT, "public")));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith("video/")) return cb(new Error("Please upload a video file."));
    cb(null, true);
  }
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please sign in first." });
  next();
}
function safeUser(id) {
  return db.prepare("SELECT id, email, created_at FROM users WHERE id = ?").get(id);
}

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "ClipForge AI", videoEngine: "FFmpeg" }));
app.get("/api/me", (req, res) => res.json({ user: req.session.userId ? safeUser(req.session.userId) : null }));

app.post("/api/register", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters." });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
    req.session.userId = Number(result.lastInsertRowid);
    res.json({ user: safeUser(req.session.userId) });
  } catch {
    res.status(409).json({ error: "That email is already registered." });
  }
});

app.post("/api/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
  req.session.userId = user.id;
  res.json({ user: safeUser(user.id) });
});

app.post("/api/logout", (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get("/api/clips", requireAuth, (req, res) => {
  const clips = db.prepare("SELECT id, filename, original_name, created_at FROM clips WHERE user_id = ? ORDER BY id DESC").all(req.session.userId);
  res.json({ clips: clips.map(c => ({ ...c, url: `/clips/${encodeURIComponent(c.filename)}` })) });
});

app.post("/api/clips", requireAuth, upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a video first." });
  const start = Math.max(0, Number(req.body.start || 0));
  const duration = Number(req.body.duration || 30);
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0 || duration > 180) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Choose a clip duration between 1 and 180 seconds." });
  }
  const outputName = crypto.randomUUID() + ".mp4";
  const outputPath = path.join(OUTPUT_DIR, outputName);
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-ss", String(start), "-i", req.file.path,
    "-t", String(duration), "-map", "0:v:0?", "-map", "0:a:0?",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
    "-c:a", "aac", "-movflags", "+faststart", outputPath
  ]);
  let errorText = "";
  ffmpeg.stderr.on("data", chunk => errorText += chunk.toString());
  ffmpeg.on("error", () => {
    fs.unlink(req.file.path, () => {});
    res.status(500).json({ error: "FFmpeg is not installed or could not start. Check the Docker deployment." });
  });
  ffmpeg.on("close", code => {
    fs.unlink(req.file.path, () => {});
    if (code !== 0 || !fs.existsSync(outputPath)) {
      return res.status(500).json({ error: "Video processing failed. Try another video. " + errorText.slice(0, 180) });
    }
    const result = db.prepare("INSERT INTO clips (user_id, filename, original_name) VALUES (?, ?, ?)").run(
      req.session.userId, outputName, req.file.originalname.slice(0, 180)
    );
    res.json({ clip: { id: Number(result.lastInsertRowid), filename: outputName, url: `/clips/${outputName}` } });
  });
});

app.get("/clips/:filename", requireAuth, (req, res) => {
  const clip = db.prepare("SELECT filename FROM clips WHERE filename = ? AND user_id = ?").get(req.params.filename, req.session.userId);
  if (!clip) return res.sendStatus(404);
  res.download(path.join(OUTPUT_DIR, clip.filename));
});

// Billing is deliberately disabled until the merchant has supplied verified PayFast credentials
// and the recurring-payment notification flow has been configured and tested.
app.get("/api/billing/status", (_req, res) => res.json({
  enabled: false,
  provider: "PayFast",
  message: "Billing is not live yet. Configure PayFast credentials and verify sandbox payments before enabling subscriptions."
}));
app.post("/api/billing/checkout", requireAuth, (_req, res) => {
  res.status(503).json({ error: "Subscriptions are not enabled yet. The owner must finish PayFast sandbox testing first." });
});

app.use((err, _req, res, _next) => {
  res.status(400).json({ error: err.message || "Something went wrong." });
});

app.listen(PORT, () => console.log(`ClipForge AI running on port ${PORT}`));
