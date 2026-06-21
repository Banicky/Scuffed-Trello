import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import bcrypt from "bcrypt";
import multer from "multer";
import multerS3 from "multer-s3";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { S3Client, DeleteObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { Strategy as GitHubStrategy } from "passport-github2";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pool from "./database.js";

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";
const SERVER_URL = process.env.SERVER_URL || "http://localhost:4000";

// Tolerate ±1 time-step (±30s) of clock drift between the user's device and the
// server when checking TOTP codes.
authenticator.options = { window: 1 };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Legacy local uploads dir — still served (see express.static below) so cards
// stored before the Spaces migration keep loading. New uploads go to Spaces.
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// DigitalOcean Spaces (S3-compatible). Origin endpoint is the region origin
// WITHOUT the bucket — the SDK prepends the bucket itself (virtual-hosted
// style). Both origin and CDN endpoints follow DO's fixed URL pattern, so
// they're derived from region/bucket rather than configured separately.
const SPACES_REGION = process.env.SPACES_REGION;
const SPACES_BUCKET = process.env.SPACES_BUCKET;
const SPACES_ORIGIN = `https://${SPACES_REGION}.digitaloceanspaces.com`;
const SPACES_CDN = `https://${SPACES_BUCKET}.${SPACES_REGION}.cdn.digitaloceanspaces.com`;

// Per-user storage cap (total bytes of all live uploads). Reject uploads that
// would push a user over this. Caps both storage growth and the egress an
// account can ever trigger by re-serving its own files.
const USER_STORAGE_CAP = 50 * 1024 * 1024; // 50 MB / user

// Signed-URL lifetime for the image proxy. Short so a leaked URL stops working
// quickly; long enough that a page's <img> tags don't re-mint mid-view.
const SIGNED_URL_TTL = 300; // seconds
const s3 = new S3Client({
  region: SPACES_REGION,
  endpoint: SPACES_ORIGIN,
  forcePathStyle: false,
  credentials: {
    accessKeyId: process.env.SPACES_KEY,
    secretAccessKey: process.env.SPACES_SECRET,
  },
});

// Uploads are filed under uploads/<type>/ so avatars, card images, board
// backgrounds and comment images don't all land in one flat prefix. The type
// comes from the "type" form field — it must be sent before "image" in the
// multipart body since multer-s3's key fn reads req.body mid-stream.
const UPLOAD_TYPES = new Set(["avatars", "cards", "boards", "comments"]);

// Pushes uploaded files straight to bucket
const upload = multer({
  storage: multerS3({
    s3,
    bucket: SPACES_BUCKET,
    acl: "private", // objects are NOT publicly readable; served via signed-URL proxy only
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const type = UPLOAD_TYPES.has(req.body?.type) ? req.body.type : "misc";
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `uploads/${type}/${unique}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// TLDR: Deletes image in DO space to clear unused images
// Spaces CDN URL (preset avatar keys, legacy /uploads/ disk paths, null/empty).
// Fire-and-forget: a failed delete is logged but never blocks the response.
function deleteSpacesImages(...urls) {
  for (const url of urls.flat()) {
    if (!url || typeof url !== "string") continue;
    if (!SPACES_CDN || !url.startsWith(SPACES_CDN + "/")) continue;
    const key = url.slice(SPACES_CDN.length + 1);
    if (!key) continue;
    s3.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }))
      .catch(err => console.error("Spaces delete failed:", key, err.message));
    // Free the bytes against the uploader's quota. Fire-and-forget like the
    // object delete — a stale ledger row only over-counts, never loses data.
    pool.query("DELETE FROM uploads WHERE key = $1", [key])
      .catch(err => console.error("Upload ledger delete failed:", key, err.message));
  }
}

const app = express();
const PgSession = connectPgSimple(session);

app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(UPLOAD_DIR));
app.use(session({
  store: new PgSession({ pool }),
  secret: process.env.SESSION_SECRET || "dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  next();
}

// Rate limiters keyed per-user (falls back to IP pre-auth). Both protect the
// Spaces bill: uploadLimiter caps how fast an account can add storage; the
// imgLimiter caps how many distinct signed URLs an account can mint, which is
// the ceiling on the egress a single account can trigger.
// requireAuth runs before these limiters, so userId is always set in practice;
// the IP branch is a guard only and uses ipKeyGenerator to stay IPv6-safe.
const rateKey = (req) => (req.session?.userId ? `u:${req.session.userId}` : `ip:${ipKeyGenerator(req.ip)}`);
const uploadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20, // 20 uploads / 5 min / user
  keyGenerator: rateKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads, slow down" },
});
const imgLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300, // 300 image fetches / min / user — generous for real page loads
  keyGenerator: rateKey,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many image requests" },
});

// ── "Remember this device" for 2FA ──────────────────────────────────────────────
const TRUST_COOKIE = "trust2fa";
const TRUST_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

// Does the request carry a valid trust cookie for this user? The cookie is
// "<userId>.<trusted_token>" and must match the user's stored token.
async function deviceIsTrusted(req, user) {
  const raw = req.cookies?.[TRUST_COOKIE];
  if (!raw || !user.trusted_token) return false;
  const [uid, token] = raw.split(".");
  return String(uid) === String(user.id) && token === user.trusted_token;
}

// Issue (or refresh) a trust cookie + its backing token for this user.
async function rememberDevice(res, userId) {
  const token = crypto.randomBytes(24).toString("hex");
  await pool.query("UPDATE users SET trusted_token = $1 WHERE id = $2", [token, userId]);
  res.cookie(TRUST_COOKIE, `${userId}.${token}`, {
    httpOnly: true,
    maxAge: TRUST_MAX_AGE,
    sameSite: "lax",
  });
}

// ── OAuth (Passport) ──────────────────────────────────────────────────────────
// We drive the session ourselves via req.session.userId, so Passport runs in
// stateless mode (session: false) and just hands us a verified profile.
app.use(passport.initialize());

// Find an existing user for this OAuth identity, or create one. We match on the
// (provider, oauth_id) pair first; failing that we link to an existing local
// account with the same email so a user isn't duplicated.
async function findOrCreateOAuthUser({ provider, oauthId, email, displayName }) {
  const byOAuth = await pool.query(
    "SELECT id, username, email FROM users WHERE oauth_provider = $1 AND oauth_id = $2",
    [provider, oauthId]
  );
  if (byOAuth.rows[0]) return byOAuth.rows[0];

  if (email) {
    const byEmail = await pool.query("SELECT id, username, email FROM users WHERE email = $1", [email]);
    if (byEmail.rows[0]) {
      await pool.query(
        "UPDATE users SET oauth_provider = $1, oauth_id = $2 WHERE id = $3",
        [provider, oauthId, byEmail.rows[0].id]
      );
      return byEmail.rows[0];
    }
  }

  // Build a unique username from the display name (or email local part).
  const base = (displayName || (email ? email.split("@")[0] : provider) || "user")
    .replace(/\s+/g, "").slice(0, 40) || "user";
  let username = base;
  for (let i = 1; ; i++) {
    const taken = await pool.query("SELECT 1 FROM users WHERE username = $1", [username]);
    if (taken.rowCount === 0) break;
    username = `${base}${i}`;
  }

  // Email is required + unique in the schema; synthesize a placeholder when the
  // provider doesn't return one (e.g. a GitHub account with no public email).
  const safeEmail = email || `${provider}_${oauthId}@oauth.local`;
  const result = await pool.query(
    "INSERT INTO users (username, email, oauth_provider, oauth_id) VALUES ($1, $2, $3, $4) RETURNING id, username, email",
    [username, safeEmail, provider, oauthId]
  );
  return result.rows[0];
}

const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const githubConfigured = !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);

if (googleConfigured) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${SERVER_URL}/api/auth/google/callback`,
    scope: ["profile", "email"],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser({
        provider: "google",
        oauthId: profile.id,
        email: profile.emails?.[0]?.value,
        displayName: profile.displayName,
      });
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
}

if (githubConfigured) {
  passport.use(new GitHubStrategy({
    clientID: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    callbackURL: `${SERVER_URL}/api/auth/github/callback`,
    scope: ["user:email"],
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const user = await findOrCreateOAuthUser({
        provider: "github",
        oauthId: String(profile.id),
        email: profile.emails?.[0]?.value,
        displayName: profile.displayName || profile.username,
      });
      done(null, user);
    } catch (err) {
      done(err);
    }
  }));
}

// helper: check if user owns, is a direct member, or is a guild member of the board
async function canAccessBoard(userId, boardId) {
  const result = await pool.query(
    `SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2
     UNION
     SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2
     UNION
     SELECT 1 FROM boards b
       JOIN guilds g ON g.id = b.guild_id
       WHERE b.id = $1
         AND (g.owner_id = $2 OR EXISTS (
           SELECT 1 FROM guild_members WHERE guild_id = g.id AND user_id = $2
         ))`,
    [boardId, userId]
  );
  return result.rowCount > 0;
}

// per-board ordered list of card counts per column, for the tile previews
const COLUMN_COUNTS_SQL = `(
  SELECT COALESCE(jsonb_agg(x.cnt ORDER BY x.position), '[]'::jsonb)
  FROM (
    SELECT col.position, COUNT(cards.id)::int AS cnt
    FROM columns col
    LEFT JOIN cards ON cards.column_id = col.id
    WHERE col.board_id = b.id
    GROUP BY col.id, col.position
  ) x
)`;

// everyone on the board — the owner first, then invited members — for the
// member avatars on each tile
const BOARD_MEMBERS_SQL = `(
  SELECT COALESCE(
    jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url)
              ORDER BY (u.id <> b.owner_id), u.username),
    '[]'::jsonb)
  FROM users u
  WHERE u.id = b.owner_id
     OR u.id IN (SELECT user_id FROM board_members WHERE board_id = b.id)
)`;

async function isOwner(userId, boardId) {
  const result = await pool.query(
    "SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2",
    [boardId, userId]
  );
  return result.rowCount > 0;
}

function tooLong(val, max) {
  return val && val.length > max;
}

// Record a card activity entry for the board's notification feed. To avoid
// spamming the log with a burst of saves, a repeated (same user, same card,
// same action) event within the dedupe window just bumps the existing row's
// timestamp instead of inserting a new one.
const ACTIVITY_DEDUPE_MS = 60 * 1000;
async function logActivity({ boardId, cardId, userId, action, cardTitle }) {
  try {
    if (cardId) {
      const recent = await pool.query(
        `SELECT id FROM card_activity
         WHERE board_id = $1 AND card_id = $2 AND user_id = $3 AND action = $4
           AND created_at > NOW() - INTERVAL '${ACTIVITY_DEDUPE_MS} milliseconds'
         ORDER BY created_at DESC LIMIT 1`,
        [boardId, cardId, userId, action]
      );
      if (recent.rows[0]) {
        await pool.query(
          "UPDATE card_activity SET created_at = NOW(), card_title = $1 WHERE id = $2",
          [cardTitle || null, recent.rows[0].id]
        );
        return;
      }
    }
    await pool.query(
      "INSERT INTO card_activity (board_id, card_id, user_id, action, card_title) VALUES ($1, $2, $3, $4, $5)",
      [boardId, cardId || null, userId, action, cardTitle || null]
    );
    // Keep the log bounded: retain only the 30 most recent rows per board,
    // pruning the oldest so the table can't grow without limit.
    await pool.query(
      `DELETE FROM card_activity
       WHERE board_id = $1 AND id NOT IN (
         SELECT id FROM card_activity WHERE board_id = $1 ORDER BY created_at DESC, id DESC LIMIT 30
       )`,
      [boardId]
    );
  } catch (err) {
    // Activity logging is best-effort — never fail the underlying card action.
    console.error("logActivity failed:", err.message);
  }
}

// Record a board-level deed (rename / delete) for the owner's Cosmic Activity.
// Unlike card_activity, board_activity is deliberately NOT foreign-keyed to
// boards, so a "deleted" entry outlives the board it describes. board_title and
// detail (e.g. the previous name on a rename) are denormalised so the row still
// reads on its own once the board is gone.
async function logBoardActivity({ userId, boardId, action, title, detail }) {
  try {
    await pool.query(
      "INSERT INTO board_activity (user_id, board_id, action, board_title, detail) VALUES ($1, $2, $3, $4, $5)",
      [userId, boardId || null, action, title || null, detail || null]
    );
    // Keep the log bounded: retain only this user's 50 most recent entries.
    await pool.query(
      `DELETE FROM board_activity
       WHERE user_id = $1 AND id NOT IN (
         SELECT id FROM board_activity WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50
       )`,
      [userId]
    );
  } catch (err) {
    // Best-effort — never fail the underlying board action over logging.
    console.error("logBoardActivity failed:", err.message);
  }
}

// Records a login for the daily streak. Idempotent per day: signing in again
// today is a no-op; a sign-in the very next calendar day extends the streak;
// any longer gap resets it to 1. Returns the current streak count.
async function bumpStreak(userId) {
  try {
    const result = await pool.query(
      `UPDATE users SET
         streak_count = CASE
           WHEN streak_last_date = CURRENT_DATE THEN streak_count
           WHEN streak_last_date = CURRENT_DATE - 1 THEN streak_count + 1
           ELSE 1
         END,
         streak_last_date = CURRENT_DATE
       WHERE id = $1
       RETURNING streak_count`,
      [userId]
    );
    const count = result.rows[0]?.streak_count ?? 0;
    await pool.query(
      "UPDATE users SET longest_streak = GREATEST(longest_streak, $2) WHERE id = $1",
      [userId, count]
    );
    return count;
  } catch (err) {
    // Best-effort — never block a login on streak bookkeeping.
    console.error("bumpStreak failed:", err.message);
    return 0;
  }
}

// ── Health ──────────────────────────────────────────────────────────────────

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// ── Auth ─────────────────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  const { username, email, password } = req.body;
  if (!username?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "Username, email and password are required" });
  }
  if (tooLong(username, 50)) return res.status(400).json({ error: "Username must be 50 characters or fewer" });
  if (tooLong(email, 255)) return res.status(400).json({ error: "Email must be 255 characters or fewer" });
  if (tooLong(password, 255)) return res.status(400).json({ error: "Password must be 255 characters or fewer" });

  const existing = await pool.query(
    "SELECT id FROM users WHERE username = $1 OR email = $2",
    [username.trim(), email.trim()]
  );
  if (existing.rowCount > 0) {
    return res.status(409).json({ error: "Username or email already taken" });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, avatar_url",
    [username.trim(), email.trim(), password_hash]
  );
  const user = result.rows[0];
  req.session.userId = user.id;
  res.status(201).json(user);
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username?.trim() || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const result = await pool.query(
    "SELECT * FROM users WHERE username = $1 OR email = $1",
    [username.trim()]
  );
  const user = result.rows[0];
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  if (!user.password_hash) {
    return res.status(401).json({ error: "This account uses social login. Sign in with Google or GitHub." });
  }

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  // 2FA gate: hold the login in a pending state until a valid TOTP code is
  // submitted to /api/auth/2fa/login — unless this device was remembered.
  if (user.totp_enabled && !(await deviceIsTrusted(req, user))) {
    req.session.pending2faUserId = user.id;
    return res.json({ twoFactorRequired: true });
  }

  req.session.userId = user.id;
  const streak_count = await bumpStreak(user.id);
  res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url ?? null, totp_enabled: user.totp_enabled, streak_count });
});

// POST /api/auth/2fa/login — second step of a 2FA-gated login. Verifies the TOTP
// code against the pending user and, on success, completes the session.
app.post("/api/auth/2fa/login", async (req, res) => {
  const pendingId = req.session.pending2faUserId;
  if (!pendingId) return res.status(401).json({ error: "No pending login" });

  const { token, remember } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: "Authentication code is required" });

  const result = await pool.query(
    "SELECT id, username, email, avatar_url, totp_secret FROM users WHERE id = $1",
    [pendingId]
  );
  const user = result.rows[0];
  if (!user || !user.totp_secret) return res.status(401).json({ error: "No pending login" });

  if (!authenticator.check(token.trim(), user.totp_secret)) {
    return res.status(401).json({ error: "Invalid authentication code" });
  }

  if (remember) await rememberDevice(res, user.id);

  delete req.session.pending2faUserId;
  req.session.userId = user.id;
  const streak_count = await bumpStreak(user.id);
  res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, totp_enabled: true, streak_count });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// ── OAuth routes ───────────────────────────────────────────────────────────────
// Each provider gets a start route (redirects to the provider) and a callback
// route (provider redirects back here). On success we log the user in by setting
// req.session.userId, then bounce back to the frontend.

function registerOAuthRoutes(provider) {
  app.get(`/api/auth/${provider}`, (req, res, next) => {
    passport.authenticate(provider, { session: false })(req, res, next);
  });

  app.get(`/api/auth/${provider}/callback`, (req, res, next) => {
    passport.authenticate(provider, { session: false }, (err, user) => {
      if (err || !user) {
        return res.redirect(`${CLIENT_URL}/#/?oauth_error=${provider}`);
      }
      req.session.userId = user.id;
      bumpStreak(user.id).catch(() => {});
      res.redirect(`${CLIENT_URL}/#/`);
    })(req, res, next);
  });
}

if (googleConfigured) registerOAuthRoutes("google");
if (githubConfigured) registerOAuthRoutes("github");

// Tells the frontend which OAuth buttons to show (only configured providers).
app.get("/api/auth/providers", (req, res) => {
  res.json({ google: googleConfigured, github: githubConfigured });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { username, newPassword } = req.body;
  if (!username?.trim() || !newPassword) {
    return res.status(400).json({ error: "Username/email and new password are required" });
  }
  if (tooLong(newPassword, 255)) return res.status(400).json({ error: "Password must be 255 characters or fewer" });

  const result = await pool.query(
    "SELECT id FROM users WHERE username = $1 OR email = $1",
    [username.trim()]
  );
  if (!result.rows[0]) return res.status(404).json({ error: "No account found with that username or email" });

  const password_hash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [password_hash, result.rows[0].id]);
  res.json({ success: true });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Both current and new password are required" });
  }
  if (tooLong(newPassword, 255)) return res.status(400).json({ error: "Password must be 255 characters or fewer" });

  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.session.userId]);
  if (!result.rows[0].password_hash) {
    return res.status(400).json({ error: "This account uses social login and has no password to change" });
  }
  const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
  if (!match) return res.status(401).json({ error: "Current password is incorrect" });

  const password_hash = await bcrypt.hash(newPassword, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [password_hash, req.session.userId]);
  res.json({ success: true });
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const result = await pool.query(
    "SELECT id, username, email, avatar_url, totp_enabled, streak_count, longest_streak FROM users WHERE id = $1",
    [req.session.userId]
  );
  if (!result.rows[0]) return res.status(401).json({ error: "Unauthorized" });
  res.json(result.rows[0]);
});

// GET /api/me/activity — "Cosmic Activity": the signed-in user's own recent
// deeds across boards, guilds and cards, merged into one reverse-chronological
// feed. Each row is { created_at, kind, action, title, context, board_id }.
app.get("/api/me/activity", requireAuth, async (req, res) => {
  const uid = req.session.userId;
  const result = await pool.query(
    `SELECT * FROM (
       -- card actions this user performed (create/edit/move/delete)
       SELECT a.created_at, 'card'::text AS kind, a.action::text AS action,
              a.card_title AS title, b.title AS context, b.id AS board_id
       FROM card_activity a JOIN boards b ON b.id = a.board_id
       WHERE a.user_id = $1

       UNION ALL
       -- boards this user charted
       SELECT b.created_at, 'board', 'created', b.title, NULL, b.id
       FROM boards b WHERE b.owner_id = $1

       UNION ALL
       -- board renames / deletions this user performed (survive the board itself)
       SELECT ba.created_at, 'board', ba.action::text, ba.board_title, ba.detail, ba.board_id
       FROM board_activity ba WHERE ba.user_id = $1

       UNION ALL
       -- guilds this user founded
       SELECT g.created_at, 'guild', 'founded', g.name, NULL, NULL
       FROM guilds g WHERE g.owner_id = $1

       UNION ALL
       -- guilds this user joined (but does not own)
       SELECT gm.joined_at, 'guild', 'joined', g.name, NULL, NULL
       FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id
       WHERE gm.user_id = $1 AND g.owner_id <> $1
     ) feed
     WHERE created_at IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 15`,
    [uid]
  );
  res.json(result.rows);
});

// PATCH /api/users/me — update avatar (preset key or uploaded image path)
app.patch("/api/users/me", requireAuth, async (req, res) => {
  const { avatar_url } = req.body;
  const prev = await pool.query("SELECT avatar_url FROM users WHERE id = $1", [req.session.userId]);
  const result = await pool.query(
    "UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, username, email, avatar_url",
    [avatar_url ?? null, req.session.userId]
  );
  if (prev.rows[0]?.avatar_url !== (avatar_url ?? null)) deleteSpacesImages(prev.rows[0]?.avatar_url);
  res.json(result.rows[0]);
});

// PATCH /api/auth/profile — update the logged-in user's username, email and/or
// avatar. Only the fields present in the body are touched.
app.patch("/api/auth/profile", requireAuth, async (req, res) => {
  const { username, email, avatar_url } = req.body;

  if (username !== undefined) {
    if (!username.trim()) return res.status(400).json({ error: "Username cannot be empty" });
    if (tooLong(username, 50)) return res.status(400).json({ error: "Username must be 50 characters or fewer" });
  }
  if (email !== undefined) {
    if (!email.trim()) return res.status(400).json({ error: "Email cannot be empty" });
    if (tooLong(email, 255)) return res.status(400).json({ error: "Email must be 255 characters or fewer" });
  }

  // Reject a username/email already taken by a *different* user.
  if (username !== undefined || email !== undefined) {
    const clash = await pool.query(
      "SELECT id FROM users WHERE (username = $1 OR email = $2) AND id <> $3",
      [username?.trim() || "", email?.trim() || "", req.session.userId]
    );
    if (clash.rowCount > 0) {
      return res.status(409).json({ error: "Username or email already taken" });
    }
  }

  const fields = [];
  const values = [];
  if (username !== undefined) { fields.push(`username = $${values.length + 1}`); values.push(username.trim()); }
  if (email !== undefined) { fields.push(`email = $${values.length + 1}`); values.push(email.trim()); }
  if (avatar_url !== undefined) { fields.push(`avatar_url = $${values.length + 1}`); values.push(avatar_url || null); }
  if (fields.length === 0) return res.status(400).json({ error: "Nothing to update" });

  const prevAvatar = avatar_url !== undefined
    ? (await pool.query("SELECT avatar_url FROM users WHERE id = $1", [req.session.userId])).rows[0]?.avatar_url
    : null;

  values.push(req.session.userId);
  const result = await pool.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, username, email, avatar_url`,
    values
  );
  if (avatar_url !== undefined && prevAvatar !== (avatar_url || null)) deleteSpacesImages(prevAvatar);
  res.json(result.rows[0]);
});

// POST /api/users/password — change password (requires current password)
app.post("/api/users/password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: "Both fields required" });
  if (new_password.length < 6)
    return res.status(400).json({ error: "New password must be at least 6 characters" });
  const result = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.session.userId]);
  const match = await bcrypt.compare(current_password, result.rows[0].password_hash);
  if (!match) return res.status(401).json({ error: "Current password is incorrect" });
  const hash = await bcrypt.hash(new_password, 10);
  await pool.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.session.userId]);
  res.json({ success: true });
});

// ── Two-factor auth (TOTP) ──────────────────────────────────────────────────────

// POST /api/auth/2fa/setup — begin enrolment. Generates a fresh secret, stores it
// (unconfirmed: totp_enabled stays false), and returns an otpauth URL + QR data
// URL for the user's authenticator app. Confirmed by /2fa/enable.
app.post("/api/auth/2fa/setup", requireAuth, async (req, res) => {
  const userRes = await pool.query("SELECT email, username, totp_enabled FROM users WHERE id = $1", [req.session.userId]);
  const user = userRes.rows[0];

  // Guard: don't mint a new secret over an already-active one — that would
  // invalidate the authenticator the user already has. They must disable first.
  if (user.totp_enabled) {
    return res.status(400).json({ error: "2FA is already enabled. Disable it first to re-enrol." });
  }

  const secret = authenticator.generateSecret();
  const accountName = user.email || user.username;
  const otpauth = authenticator.keyuri(accountName, "Scuffed Trello", secret);
  const qr = await QRCode.toDataURL(otpauth);

  // Store the pending secret; enrolment isn't active until /2fa/enable verifies it.
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [secret, req.session.userId]);

  res.json({ secret, otpauth, qr });
});

// POST /api/auth/2fa/enable — confirm enrolment with a code from the app.
app.post("/api/auth/2fa/enable", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: "Authentication code is required" });

  const result = await pool.query("SELECT totp_secret FROM users WHERE id = $1", [req.session.userId]);
  const secret = result.rows[0]?.totp_secret;
  if (!secret) return res.status(400).json({ error: "Start 2FA setup first" });

  if (!authenticator.check(token.trim(), secret)) {
    return res.status(401).json({ error: "Invalid authentication code" });
  }

  await pool.query("UPDATE users SET totp_enabled = true WHERE id = $1", [req.session.userId]);
  res.json({ totp_enabled: true });
});

// POST /api/auth/2fa/disable — turn 2FA off; requires a valid current code.
app.post("/api/auth/2fa/disable", requireAuth, async (req, res) => {
  const { token } = req.body;
  if (!token?.trim()) return res.status(400).json({ error: "Authentication code is required" });

  const result = await pool.query(
    "SELECT totp_secret, totp_enabled FROM users WHERE id = $1",
    [req.session.userId]
  );
  const user = result.rows[0];
  if (!user?.totp_enabled || !user.totp_secret) {
    return res.status(400).json({ error: "2FA is not enabled" });
  }
  if (!authenticator.check(token.trim(), user.totp_secret)) {
    return res.status(401).json({ error: "Invalid authentication code" });
  }

  await pool.query(
    "UPDATE users SET totp_enabled = false, totp_secret = NULL, trusted_token = NULL WHERE id = $1",
    [req.session.userId]
  );
  res.clearCookie(TRUST_COOKIE);
  res.json({ totp_enabled: false });
});

// ── Boards ───────────────────────────────────────────────────────────────────

// returns boards owned by or shared with the logged-in user
app.get("/api/boards", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT b.*, 'owner' AS role, ba.accessed_at AS last_accessed_at,
            g.name AS guild_name, g.icon_color AS guild_icon_color,
            ${COLUMN_COUNTS_SQL} AS column_counts, ${BOARD_MEMBERS_SQL} AS members
       FROM boards b
       LEFT JOIN board_access ba ON ba.board_id = b.id AND ba.user_id = $1
       LEFT JOIN guilds g ON g.id = b.guild_id
       WHERE b.owner_id = $1
     UNION
     SELECT b.*, 'member' AS role, ba.accessed_at AS last_accessed_at,
            g.name AS guild_name, g.icon_color AS guild_icon_color,
            ${COLUMN_COUNTS_SQL} AS column_counts, ${BOARD_MEMBERS_SQL} AS members
       FROM boards b
       JOIN board_members bm ON bm.board_id = b.id
       LEFT JOIN board_access ba ON ba.board_id = b.id AND ba.user_id = $1
       LEFT JOIN guilds g ON g.id = b.guild_id
       WHERE bm.user_id = $1
     ORDER BY id`,
    [req.session.userId]
  );
  res.json(result.rows);
});

app.post("/api/boards", requireAuth, async (req, res) => {
  const { title, guild_id } = req.body;
  if (tooLong(title, 255)) return res.status(400).json({ error: "Title must be 255 characters or fewer" });
  if (guild_id) {
    const access = await pool.query(
      `SELECT 1 FROM guilds WHERE id = $1 AND owner_id = $2
       UNION SELECT 1 FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
      [guild_id, req.session.userId]
    );
    if (!access.rowCount) return res.status(403).json({ error: "Not a guild member" });
  }
  const result = await pool.query(
    "INSERT INTO boards (title, owner_id, guild_id) VALUES ($1, $2, $3) RETURNING *",
    [title, req.session.userId, guild_id || null]
  );
  res.json({ ...result.rows[0], role: "owner" });
});

app.get("/api/boards/:id", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // record this user's most recent visit to the board
  await pool.query(
    `INSERT INTO board_access (board_id, user_id, accessed_at) VALUES ($1, $2, NOW())
     ON CONFLICT (board_id, user_id) DO UPDATE SET accessed_at = NOW()`,
    [req.params.id, req.session.userId]
  );
  const result = await pool.query("SELECT * FROM boards WHERE id = $1", [req.params.id]);
  res.json(result.rows[0]);
});

// GET /api/boards/:id/preview — columns with a few card titles each, for the
// dashboard hover preview. Capped so the payload stays small.
app.get("/api/boards/:id/preview", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT col.id, col.title,
            (SELECT COUNT(*)::int FROM cards WHERE cards.column_id = col.id) AS card_count,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title) ORDER BY c.position)
              FROM (
                SELECT cards.id, cards.title, cards.position
                FROM cards
                WHERE cards.column_id = col.id ORDER BY cards.position LIMIT 8
              ) c
            ), '[]'::jsonb) AS cards
     FROM columns col
     WHERE col.board_id = $1
     ORDER BY col.position`,
    [req.params.id]
  );
  res.json({ columns: result.rows });
});

// GET /api/boards/:id/activity — recent card activity for the notification bell.
app.get("/api/boards/:id/activity", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT a.id, a.card_id, a.action, a.card_title, a.created_at, u.username
     FROM card_activity a
     LEFT JOIN users u ON u.id = a.user_id
     WHERE a.board_id = $1
     ORDER BY a.created_at DESC
     LIMIT 50`,
    [req.params.id]
  );
  res.json(result.rows);
});

app.patch("/api/boards/:id", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // partial update: only the provided fields change (title and/or the
  // decorative background). background_image may be set to null to clear it.
  const { title, background_image, background_opacity } = req.body;
  if (tooLong(title, 255)) return res.status(400).json({ error: "Title must be 255 characters or fewer" });
  const sets = [];
  const values = [];
  let i = 1;
  if (title !== undefined) { sets.push(`title = $${i++}`); values.push(title); }
  if (background_image !== undefined) { sets.push(`background_image = $${i++}`); values.push(background_image); }
  if (background_opacity !== undefined) {
    const clamped = Math.max(0, Math.min(100, Number(background_opacity) || 0));
    sets.push(`background_opacity = $${i++}`);
    values.push(clamped);
  }
  if (sets.length === 0) {
    const current = await pool.query("SELECT * FROM boards WHERE id = $1", [req.params.id]);
    return res.json(current.rows[0]);
  }
  const prevBg = background_image !== undefined
    ? (await pool.query("SELECT background_image FROM boards WHERE id = $1", [req.params.id])).rows[0]?.background_image
    : null;
  // capture the old name before the update so a rename can record both ends
  const prevTitle = title !== undefined
    ? (await pool.query("SELECT title FROM boards WHERE id = $1", [req.params.id])).rows[0]?.title
    : null;

  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE boards SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  if (background_image !== undefined && prevBg !== background_image) deleteSpacesImages(prevBg);
  // only a genuine title change is a "rename" worth surfacing in Cosmic Activity
  if (title !== undefined && result.rows[0] && prevTitle !== result.rows[0].title) {
    await logBoardActivity({
      userId: req.session.userId,
      boardId: Number(req.params.id),
      action: "renamed",
      title: result.rows[0].title,
      detail: prevTitle,
    });
  }
  res.json(result.rows[0]);
});

app.delete("/api/boards/:id", requireAuth, async (req, res) => {
  if (!await isOwner(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Only the board owner can delete it" });
  }
  // Collect every Spaces image under this board before the cascade wipes the
  // rows: the board background, all card images, and all comment images.
  const images = await pool.query(
    `SELECT background_image AS url FROM boards WHERE id = $1
     UNION ALL
     SELECT c.image_url FROM cards c JOIN columns col ON col.id = c.column_id WHERE col.board_id = $1
     UNION ALL
     SELECT cc.image_url FROM card_comments cc
       JOIN cards c ON c.id = cc.card_id
       JOIN columns col ON col.id = c.column_id
       WHERE col.board_id = $1`,
    [req.params.id]
  );
  // grab the name before deletion so Cosmic Activity can still say what was removed
  const removed = await pool.query("SELECT title FROM boards WHERE id = $1", [req.params.id]);
  await pool.query("DELETE FROM boards WHERE id = $1", [req.params.id]);
  deleteSpacesImages(images.rows.map(r => r.url));
  await logBoardActivity({
    userId: req.session.userId,
    boardId: Number(req.params.id),
    action: "deleted",
    title: removed.rows[0]?.title,
  });
  res.json({ success: true });
});

// ── Board members ─────────────────────────────────────────────────────────────

app.get("/api/boards/:boardId/members", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.boardId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT u.id, u.username, u.email, u.avatar_url FROM users u
     JOIN board_members bm ON bm.user_id = u.id
     WHERE bm.board_id = $1`,
    [req.params.boardId]
  );
  res.json(result.rows);
});

app.post("/api/boards/:boardId/members", requireAuth, async (req, res) => {
  if (!await isOwner(req.session.userId, req.params.boardId)) {
    return res.status(403).json({ error: "Only the board owner can invite members" });
  }
  const { username } = req.body;
  const userResult = await pool.query(
    "SELECT id, username, email FROM users WHERE username = $1 OR email = $1",
    [username]
  );
  if (!userResult.rows[0]) return res.status(404).json({ error: "User not found" });
  const invitee = userResult.rows[0];

  if (invitee.id === req.session.userId) {
    return res.status(400).json({ error: "You already own this board" });
  }

  await pool.query(
    "INSERT INTO board_members (board_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [req.params.boardId, invitee.id]
  );
  res.json(invitee);
});

app.delete("/api/boards/:boardId/members/:userId", requireAuth, async (req, res) => {
  if (!await isOwner(req.session.userId, req.params.boardId)) {
    return res.status(403).json({ error: "Only the board owner can remove members" });
  }
  await pool.query(
    "DELETE FROM board_members WHERE board_id = $1 AND user_id = $2",
    [req.params.boardId, req.params.userId]
  );
  res.json({ success: true });
});

// ── Guilds ────────────────────────────────────────────────────────────────────

async function canAccessGuild(userId, guildId) {
  const result = await pool.query(
    `SELECT 1 FROM guilds WHERE id = $1 AND owner_id = $2
     UNION SELECT 1 FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
    [guildId, userId]
  );
  return result.rowCount > 0;
}

app.get("/api/guilds", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT g.id, g.name, g.icon_color, g.owner_id, g.created_at,
       (SELECT COUNT(*)::int FROM guild_members WHERE guild_id = g.id) + 1 AS member_count,
       (SELECT COUNT(*)::int FROM boards WHERE guild_id = g.id) AS board_count,
       CASE WHEN g.owner_id = $1 THEN 'owner' ELSE 'member' END AS role
     FROM guilds g
     WHERE g.owner_id = $1
        OR g.id IN (SELECT guild_id FROM guild_members WHERE user_id = $1)
     ORDER BY g.created_at`,
    [req.session.userId]
  );
  res.json(result.rows);
});

app.post("/api/guilds", requireAuth, async (req, res) => {
  const { name, icon_color } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Guild name is required" });
  const result = await pool.query(
    "INSERT INTO guilds (name, owner_id, icon_color) VALUES ($1, $2, $3) RETURNING *",
    [name.trim(), req.session.userId, icon_color || "arcane"]
  );
  res.status(201).json({ ...result.rows[0], member_count: 1, board_count: 0, role: "owner" });
});

app.get("/api/guilds/:id", requireAuth, async (req, res) => {
  if (!await canAccessGuild(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const guildResult = await pool.query("SELECT * FROM guilds WHERE id = $1", [req.params.id]);
  if (!guildResult.rows[0]) return res.status(404).json({ error: "Not found" });
  const membersResult = await pool.query(
    `SELECT u.id, u.username, u.avatar_url,
       CASE WHEN g.owner_id = u.id THEN 'owner' ELSE 'member' END AS role
     FROM guilds g
     CROSS JOIN users u
     WHERE g.id = $1
       AND (u.id = g.owner_id OR u.id IN (SELECT user_id FROM guild_members WHERE guild_id = g.id))
     ORDER BY (g.owner_id = u.id) DESC, u.username`,
    [req.params.id]
  );
  res.json({ ...guildResult.rows[0], members: membersResult.rows });
});

app.patch("/api/guilds/:id", requireAuth, async (req, res) => {
  const g = await pool.query("SELECT owner_id FROM guilds WHERE id = $1", [req.params.id]);
  if (!g.rows[0]) return res.status(404).json({ error: "Not found" });
  if (g.rows[0].owner_id !== req.session.userId) return res.status(403).json({ error: "Only the guild owner can edit it" });
  const { name, icon_color } = req.body;
  const sets = []; const vals = []; let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); vals.push(name.trim()); }
  if (icon_color !== undefined) { sets.push(`icon_color = $${i++}`); vals.push(icon_color); }
  if (!sets.length) return res.json(g.rows[0]);
  vals.push(req.params.id);
  const result = await pool.query(`UPDATE guilds SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`, vals);
  res.json(result.rows[0]);
});

app.delete("/api/guilds/:id", requireAuth, async (req, res) => {
  const g = await pool.query("SELECT owner_id FROM guilds WHERE id = $1", [req.params.id]);
  if (!g.rows[0]) return res.status(404).json({ error: "Not found" });
  if (g.rows[0].owner_id !== req.session.userId) return res.status(403).json({ error: "Only the guild owner can delete it" });
  await pool.query("DELETE FROM guilds WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.post("/api/guilds/:id/members", requireAuth, async (req, res) => {
  const g = await pool.query("SELECT owner_id FROM guilds WHERE id = $1", [req.params.id]);
  if (!g.rows[0]) return res.status(404).json({ error: "Not found" });
  if (g.rows[0].owner_id !== req.session.userId) return res.status(403).json({ error: "Only the guild owner can add members" });
  const { username } = req.body;
  const userResult = await pool.query(
    "SELECT id, username, avatar_url FROM users WHERE username = $1 OR email = $1",
    [username]
  );
  if (!userResult.rows[0]) return res.status(404).json({ error: "User not found" });
  const invitee = userResult.rows[0];
  if (invitee.id === req.session.userId) return res.status(400).json({ error: "You already own this guild" });
  await pool.query(
    "INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [req.params.id, invitee.id]
  );
  res.json({ ...invitee, role: "member" });
});

app.delete("/api/guilds/:id/members/:userId", requireAuth, async (req, res) => {
  const g = await pool.query("SELECT owner_id FROM guilds WHERE id = $1", [req.params.id]);
  if (!g.rows[0]) return res.status(404).json({ error: "Not found" });
  if (g.rows[0].owner_id !== req.session.userId) return res.status(403).json({ error: "Only the guild owner can remove members" });
  await pool.query(
    "DELETE FROM guild_members WHERE guild_id = $1 AND user_id = $2",
    [req.params.id, req.params.userId]
  );
  res.json({ success: true });
});

// POST /api/guilds/:id/invites — dispatch a guild summons (owner only)
app.post("/api/guilds/:id/invites", requireAuth, async (req, res) => {
  const g = await pool.query("SELECT * FROM guilds WHERE id = $1", [req.params.id]);
  if (!g.rows[0]) return res.status(404).json({ error: "Guild not found" });
  if (g.rows[0].owner_id !== req.session.userId) return res.status(403).json({ error: "Only the guild owner can send invites" });

  const { username } = req.body;
  const userResult = await pool.query(
    "SELECT id, username FROM users WHERE username = $1 OR email = $1",
    [username]
  );
  if (!userResult.rows[0]) return res.status(404).json({ error: "User not found" });
  const invitee = userResult.rows[0];

  if (invitee.id === req.session.userId) return res.status(400).json({ error: "You already own this guild" });

  const already = await pool.query(
    `SELECT 1 FROM guilds WHERE id = $1 AND owner_id = $2
     UNION SELECT 1 FROM guild_members WHERE guild_id = $1 AND user_id = $2`,
    [req.params.id, invitee.id]
  );
  if (already.rowCount > 0) return res.status(400).json({ error: "That warrior is already in the guild" });

  const invite = await pool.query(
    `INSERT INTO guild_invites (guild_id, inviter_id, invitee_id, status)
     VALUES ($1, $2, $3, 'pending')
     ON CONFLICT (guild_id, invitee_id) DO UPDATE SET status = 'pending', created_at = NOW()
     RETURNING *`,
    [req.params.id, req.session.userId, invitee.id]
  );

  const inviter = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
  await pool.query(
    `INSERT INTO notifications (user_id, type, data) VALUES ($1, 'guild_invite', $2)`,
    [invitee.id, JSON.stringify({
      invite_id: invite.rows[0].id,
      guild_id: parseInt(req.params.id),
      guild_name: g.rows[0].name,
      guild_icon_color: g.rows[0].icon_color,
      inviter_username: inviter.rows[0].username,
    })]
  );

  res.json({ success: true, invitee: { id: invitee.id, username: invitee.username } });
});

// GET /api/notifications — all notifications for the current user
app.get("/api/notifications", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.session.userId]
  );
  res.json(result.rows);
});

// POST /api/notifications/read-all
app.post("/api/notifications/read-all", requireAuth, async (req, res) => {
  await pool.query("UPDATE notifications SET read = true WHERE user_id = $1", [req.session.userId]);
  res.json({ success: true });
});

// PATCH /api/notifications/:id/read — mark one notification read
app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
  await pool.query(
    "UPDATE notifications SET read = true WHERE id = $1 AND user_id = $2",
    [req.params.id, req.session.userId]
  );
  res.json({ success: true });
});

// POST /api/guild-invites/:id/accept
app.post("/api/guild-invites/:id/accept", requireAuth, async (req, res) => {
  const invite = await pool.query("SELECT * FROM guild_invites WHERE id = $1", [req.params.id]);
  if (!invite.rows[0]) return res.status(404).json({ error: "Invite not found" });
  if (invite.rows[0].invitee_id !== req.session.userId) return res.status(403).json({ error: "This summons is not for you" });
  if (invite.rows[0].status !== "pending") return res.status(400).json({ error: "Summons is no longer pending" });

  await pool.query(
    "INSERT INTO guild_members (guild_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [invite.rows[0].guild_id, req.session.userId]
  );
  await pool.query("UPDATE guild_invites SET status = 'accepted' WHERE id = $1", [req.params.id]);
  await pool.query(
    `UPDATE notifications SET read = true
     WHERE user_id = $1 AND type = 'guild_invite' AND (data->>'invite_id')::int = $2`,
    [req.session.userId, parseInt(req.params.id)]
  );

  const guild = await pool.query(
    `SELECT g.id, g.name, g.icon_color, g.owner_id, g.created_at,
       (SELECT COUNT(*)::int FROM guild_members WHERE guild_id = g.id) + 1 AS member_count,
       (SELECT COUNT(*)::int FROM boards WHERE guild_id = g.id) AS board_count,
       'member' AS role
     FROM guilds g WHERE g.id = $1`,
    [invite.rows[0].guild_id]
  );
  res.json({ success: true, guild: guild.rows[0] });
});

// POST /api/guild-invites/:id/decline
app.post("/api/guild-invites/:id/decline", requireAuth, async (req, res) => {
  const invite = await pool.query("SELECT * FROM guild_invites WHERE id = $1", [req.params.id]);
  if (!invite.rows[0]) return res.status(404).json({ error: "Invite not found" });
  if (invite.rows[0].invitee_id !== req.session.userId) return res.status(403).json({ error: "This summons is not for you" });

  await pool.query("UPDATE guild_invites SET status = 'declined' WHERE id = $1", [req.params.id]);
  await pool.query(
    `UPDATE notifications SET read = true
     WHERE user_id = $1 AND type = 'guild_invite' AND (data->>'invite_id')::int = $2`,
    [req.session.userId, parseInt(req.params.id)]
  );
  res.json({ success: true });
});

app.get("/api/guilds/:id/boards", requireAuth, async (req, res) => {
  if (!await canAccessGuild(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT b.*,
       CASE WHEN b.owner_id = $2 THEN 'owner' ELSE 'member' END AS role,
       ba.accessed_at AS last_accessed_at,
       ${COLUMN_COUNTS_SQL} AS column_counts,
       ${BOARD_MEMBERS_SQL} AS members
     FROM boards b
     LEFT JOIN board_access ba ON ba.board_id = b.id AND ba.user_id = $2
     WHERE b.guild_id = $1
     ORDER BY b.id`,
    [req.params.id, req.session.userId]
  );
  res.json(result.rows);
});

// ── Columns ───────────────────────────────────────────────────────────────────

app.get("/api/boards/:boardId/columns", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.boardId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    "SELECT * FROM columns WHERE board_id = $1 ORDER BY position",
    [req.params.boardId]
  );
  res.json(result.rows);
});

app.post("/api/columns", requireAuth, async (req, res) => {
  const { board_id, title, position } = req.body;
  if (!await canAccessBoard(req.session.userId, board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const countResult = await pool.query("SELECT COUNT(*) FROM columns WHERE board_id = $1", [board_id]);
  if (parseInt(countResult.rows[0].count) >= 10) {
    return res.status(400).json({ error: "Column limit reached (max 10)" });
  }
  const result = await pool.query(
    "INSERT INTO columns (board_id, title, position) VALUES ($1, $2, $3) RETURNING *",
    [board_id, title, position]
  );
  res.json(result.rows[0]);
});

app.delete("/api/columns/:id", requireAuth, async (req, res) => {
  const col = await pool.query("SELECT board_id FROM columns WHERE id = $1", [req.params.id]);
  if (!col.rows[0] || !await canAccessBoard(req.session.userId, col.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await pool.query("DELETE FROM columns WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.patch("/api/columns/:id", requireAuth, async (req, res) => {
  const col = await pool.query("SELECT board_id FROM columns WHERE id = $1", [req.params.id]);
  if (!col.rows[0] || !await canAccessBoard(req.session.userId, col.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { title, position } = req.body;
  const fields = [];
  const values = [];
  if (title !== undefined) { fields.push(`title = $${values.length + 1}`); values.push(title); }
  if (position !== undefined) { fields.push(`position = $${values.length + 1}`); values.push(position); }
  if (fields.length === 0) return res.status(400).json({ error: "Nothing to update" });
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE columns SET ${fields.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values
  );
  res.json(result.rows[0]);
});

// ── Cards ─────────────────────────────────────────────────────────────────────

app.get("/api/columns/:columnId/cards", requireAuth, async (req, res) => {
  const col = await pool.query("SELECT board_id FROM columns WHERE id = $1", [req.params.columnId]);
  if (!col.rows[0] || !await canAccessBoard(req.session.userId, col.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT cards.*,
            creator.username AS created_by_username,
            editor.username AS last_edited_by_username,
            (SELECT COUNT(*)::int FROM card_comments cc WHERE cc.card_id = cards.id) AS comment_count
     FROM cards
     LEFT JOIN users creator ON creator.id = cards.created_by
     LEFT JOIN users editor ON editor.id = cards.last_edited_by
     WHERE cards.column_id = $1
     ORDER BY cards.position`,
    [req.params.columnId]
  );
  res.json(result.rows);
});

app.post("/api/cards", requireAuth, async (req, res) => {
  const { column_id, title, description, position, image_url } = req.body;
  const col = await pool.query("SELECT board_id FROM columns WHERE id = $1", [column_id]);
  if (!col.rows[0] || !await canAccessBoard(req.session.userId, col.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  if (tooLong(title, 255)) return res.status(400).json({ error: "Title must be 255 characters or fewer" });
  if (tooLong(description, 3000)) return res.status(400).json({ error: "Description must be 3000 characters or fewer" });

  const cardResult = await pool.query(
    "INSERT INTO cards (column_id, title, description, position, created_by, updated_at, image_url) VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING *",
    [column_id, title, description, position, req.session.userId, image_url || null]
  );
  const card = cardResult.rows[0];

  const user = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
  await logActivity({ boardId: col.rows[0].board_id, cardId: card.id, userId: req.session.userId, action: "created", cardTitle: card.title });
  res.json({ ...card, created_by_username: user.rows[0]?.username || null });
});

app.delete("/api/cards/:id", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id, cards.title FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const images = await pool.query(
    `SELECT image_url AS url FROM cards WHERE id = $1
     UNION ALL
     SELECT image_url FROM card_comments WHERE card_id = $1`,
    [req.params.id]
  );
  await logActivity({ boardId: card.rows[0].board_id, cardId: req.params.id, userId: req.session.userId, action: "deleted", cardTitle: card.rows[0].title });
  await pool.query("DELETE FROM cards WHERE id = $1", [req.params.id]);
  deleteSpacesImages(images.rows.map(r => r.url));
  res.json({ success: true });
});

// PATCH /api/cards/:id — move card, toggle starred, or edit content
app.patch("/api/cards/:id", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { column_id, position, starred, title, description, track_edit, image_url } = req.body;

  if (starred !== undefined) {
    const result = await pool.query(
      "UPDATE cards SET starred = $1 WHERE id = $2 RETURNING *",
      [starred, req.params.id]
    );
    return res.json(result.rows[0]);
  }

  if (title !== undefined) {
    if (tooLong(title, 255)) return res.status(400).json({ error: "Title must be 255 characters or fewer" });
    if (tooLong(description, 3000)) return res.status(400).json({ error: "Description must be 3000 characters or fewer" });
    const prevImg = (await pool.query("SELECT image_url FROM cards WHERE id = $1", [req.params.id])).rows[0]?.image_url;
    const result = await pool.query(
      "UPDATE cards SET title = $1, description = $2, last_edited_by = $3, updated_at = NOW(), image_url = $4 WHERE id = $5 RETURNING *",
      [title, description || null, req.session.userId, image_url || null, req.params.id]
    );
    if (prevImg !== (image_url || null)) deleteSpacesImages(prevImg);
    const editor = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
    await logActivity({ boardId: card.rows[0].board_id, cardId: req.params.id, userId: req.session.userId, action: "edited", cardTitle: result.rows[0].title });
    return res.json({ ...result.rows[0], last_edited_by_username: editor.rows[0]?.username || null });
  }

  if (track_edit) {
    // Detect a genuine column change so a reorder within the same list isn't
    // logged as a "move".
    const before = await pool.query("SELECT column_id, title FROM cards WHERE id = $1", [req.params.id]);
    const movedColumns = before.rows[0] && String(before.rows[0].column_id) !== String(column_id);
    const result = await pool.query(
      "UPDATE cards SET column_id = $1, position = $2, last_edited_by = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
      [column_id, position, req.session.userId, req.params.id]
    );
    const editor = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
    if (movedColumns) {
      await logActivity({ boardId: card.rows[0].board_id, cardId: req.params.id, userId: req.session.userId, action: "moved", cardTitle: result.rows[0].title });
    }
    return res.json({ ...result.rows[0], last_edited_by_username: editor.rows[0]?.username || null });
  }

  const result = await pool.query(
    "UPDATE cards SET column_id = $1, position = $2 WHERE id = $3 RETURNING *",
    [column_id, position, req.params.id]
  );
  res.json(result.rows[0]);
});

// ── Comments ──────────────────────────────────────────────────────────────────

app.get("/api/cards/:id/comments", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT cc.*, u.username, u.avatar_url,
            COALESCE(
              (SELECT json_agg(jsonb_build_object('emoji', cr.emoji, 'userId', cr.user_id))
               FROM comment_reactions cr WHERE cr.comment_id = cc.id),
              '[]'::json
            ) AS reactions
     FROM card_comments cc
     JOIN users u ON u.id = cc.user_id
     WHERE cc.card_id = $1
     ORDER BY cc.created_at ASC`,
    [req.params.id]
  );
  res.json(result.rows);
});

app.post("/api/cards/:id/comments", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { body, image_url } = req.body;
  if (!body?.trim() && !image_url) {
    return res.status(400).json({ error: "Comment must have text or an image" });
  }

  const result = await pool.query(
    "INSERT INTO card_comments (card_id, user_id, body, image_url) VALUES ($1, $2, $3, $4) RETURNING *",
    [req.params.id, req.session.userId, body?.trim() || "", image_url || null]
  );
  const user = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
  res.json({ ...result.rows[0], username: user.rows[0].username, reactions: [] });
});

// Reject the upload before we stream a file to Spaces if the user is already
// at/over their storage cap. Cheap guard; the post-upload check below catches
// the single upload that tips them over.
async function checkQuota(req, res, next) {
  try {
    const { rows } = await pool.query(
      "SELECT COALESCE(SUM(bytes),0)::bigint AS used FROM uploads WHERE user_id = $1",
      [req.session.userId]
    );
    if (Number(rows[0].used) >= USER_STORAGE_CAP) {
      return res.status(413).json({ error: "Storage limit reached. Delete some images first." });
    }
    next();
  } catch (e) { next(e); }
}

// POST /api/upload — store a PRIVATE image, record it against the user's quota,
// and return a key-bearing URL the client renders through the signed-URL proxy.
app.post("/api/upload", requireAuth, uploadLimiter, checkQuota, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  const key = req.file.key; // e.g. "uploads/cards/123.png"
  const size = req.file.size || 0;

  // Record the bytes, then re-check the running total. If this upload pushed
  // the user over the cap, roll back both the ledger row and the object so a
  // single request can't exceed the cap by more than one file (≤5 MB).
  await pool.query(
    "INSERT INTO uploads (user_id, key, bytes) VALUES ($1, $2, $3)",
    [req.session.userId, key, size]
  );
  const { rows } = await pool.query(
    "SELECT COALESCE(SUM(bytes),0)::bigint AS used FROM uploads WHERE user_id = $1",
    [req.session.userId]
  );
  if (Number(rows[0].used) > USER_STORAGE_CAP) {
    await pool.query("DELETE FROM uploads WHERE key = $1", [key]);
    s3.send(new DeleteObjectCommand({ Bucket: SPACES_BUCKET, Key: key }))
      .catch(err => console.error("Spaces rollback delete failed:", key, err.message));
    return res.status(413).json({ error: "Storage limit reached. Delete some images first." });
  }

  // Stored value keeps the CDN-URL shape (no data migration); assetUrl() on the
  // client rewrites it to /api/img/<key>, which signs and redirects.
  res.json({ url: `${SPACES_CDN}/${key}` });
});

// GET /api/img/<key> — auth-gated signed-URL proxy for PRIVATE Spaces objects.
// A valid session is required, so anonymous/scripted fetching of public CDN
// URLs no longer works — egress only happens for URLs we sign here. The redirect
// target is short-lived; the browser may cache the redirect just under the TTL.
app.get(/^\/api\/img\/(.+)$/, requireAuth, imgLimiter, async (req, res) => {
  const key = decodeURIComponent(req.params[0] || "");
  // Only sign objects under our own uploads/ prefix — never arbitrary keys.
  if (!key.startsWith("uploads/")) return res.status(400).json({ error: "Bad image path" });
  try {
    const signed = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: SPACES_BUCKET, Key: key }),
      { expiresIn: SIGNED_URL_TTL }
    );
    res.set("Cache-Control", `private, max-age=${SIGNED_URL_TTL - 60}`);
    res.redirect(302, signed);
  } catch (err) {
    console.error("Sign image failed:", key, err.message);
    res.status(404).json({ error: "Image not found" });
  }
});

app.patch("/api/comments/:id", requireAuth, async (req, res) => {
  const comment = await pool.query(
    `SELECT cc.*, columns.board_id FROM card_comments cc
     JOIN cards ON cards.id = cc.card_id
     JOIN columns ON columns.id = cards.column_id
     WHERE cc.id = $1`,
    [req.params.id]
  );
  if (!comment.rows[0]) return res.status(404).json({ error: "Not found" });
  if (comment.rows[0].user_id !== req.session.userId) {
    return res.status(403).json({ error: "You can only edit your own comments" });
  }
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: "Comment body is required" });

  const result = await pool.query(
    "UPDATE card_comments SET body = $1, edited_at = NOW() WHERE id = $2 RETURNING *",
    [body.trim(), req.params.id]
  );
  const user = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
  const reactions = await pool.query(
    `SELECT emoji, user_id AS "userId" FROM comment_reactions WHERE comment_id = $1`,
    [req.params.id]
  );
  res.json({ ...result.rows[0], username: user.rows[0].username, reactions: reactions.rows });
});

// POST /api/comments/:id/reactions — toggle an emoji reaction on a comment
app.post("/api/comments/:id/reactions", requireAuth, async (req, res) => {
  const comment = await pool.query(
    `SELECT columns.board_id FROM card_comments cc
     JOIN cards ON cards.id = cc.card_id
     JOIN columns ON columns.id = cards.column_id
     WHERE cc.id = $1`,
    [req.params.id]
  );
  if (!comment.rows[0] || !await canAccessBoard(req.session.userId, comment.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: "Emoji is required" });

  const existing = await pool.query(
    "SELECT 1 FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3",
    [req.params.id, req.session.userId, emoji]
  );
  if (existing.rowCount > 0) {
    await pool.query(
      "DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2 AND emoji = $3",
      [req.params.id, req.session.userId, emoji]
    );
  } else {
    await pool.query(
      "INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES ($1, $2, $3)",
      [req.params.id, req.session.userId, emoji]
    );
  }

  const reactions = await pool.query(
    `SELECT emoji, user_id AS "userId" FROM comment_reactions WHERE comment_id = $1`,
    [req.params.id]
  );
  res.json({ reactions: reactions.rows });
});

app.delete("/api/comments/:id", requireAuth, async (req, res) => {
  const comment = await pool.query("SELECT user_id, image_url FROM card_comments WHERE id = $1", [req.params.id]);
  if (!comment.rows[0]) return res.status(404).json({ error: "Not found" });
  if (comment.rows[0].user_id !== req.session.userId) {
    return res.status(403).json({ error: "You can only delete your own comments" });
  }
  await pool.query("DELETE FROM card_comments WHERE id = $1", [req.params.id]);
  deleteSpacesImages(comment.rows[0].image_url);
  res.json({ success: true });
});

// ── Migrations ────────────────────────────────────────────────────────────────

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // OAuth users have no local password, so password_hash must allow NULL, and we
  // record which provider/identity they signed in with.
  await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_provider VARCHAR(20)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS oauth_id VARCHAR(255)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT`);

  // TOTP two-factor auth. totp_secret holds the base32 secret (set during setup,
  // before confirmation); totp_enabled flips true only once the user verifies a
  // code, and login is gated on it.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret VARCHAR(255)`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false`);
  // Per-user secret backing the "remember this device" cookie, so a trusted
  // browser can skip the 2FA prompt. Cleared when 2FA is disabled.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_token VARCHAR(64)`);

  // Login streak: consecutive calendar days the user has signed in. streak_last_date
  // is the last day we counted; bumpStreak() compares it to today on each login.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_count INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS longest_streak INTEGER NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS streak_last_date DATE`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_oauth_idx ON users (oauth_provider, oauth_id)
    WHERE oauth_provider IS NOT NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL PRIMARY KEY,
      sess JSON NOT NULL,
      expire TIMESTAMPTZ NOT NULL
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire)
  `);

  // Create DB entries in order to avoid constraints
  await pool.query(`
    CREATE TABLE IF NOT EXISTS boards (
      id SERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      owner_id INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    ALTER TABLE boards ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)
  `);
  // boards predate this column in the CREATE above, so older databases never got
  // it; Cosmic Activity orders by it. DEFAULT NOW() backfills existing rows.
  await pool.query(`
    ALTER TABLE boards ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()
  `);

  // optional decorative background image for a board, shown as a translucent
  // overlay behind the columns; opacity is a 0–100 percentage
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT
  `);

  await pool.query(`
    ALTER TABLE boards ADD COLUMN IF NOT EXISTS background_image TEXT
  `);
  await pool.query(`
    ALTER TABLE boards ADD COLUMN IF NOT EXISTS background_opacity SMALLINT NOT NULL DEFAULT 10
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_members (
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (board_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_access (
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accessed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (board_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_access (
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      accessed_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (board_id, user_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS columns (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id SERIAL PRIMARY KEY,
      column_id INTEGER NOT NULL REFERENCES columns(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      starred BOOLEAN NOT NULL DEFAULT false
    )
  `);
  await pool.query(`
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false
  `);

  await pool.query(`
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)
  `);

  await pool.query(`
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS last_edited_by INTEGER REFERENCES users(id)
  `);

  await pool.query(`
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ
  `);

  await pool.query(`
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS image_url TEXT
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_comments (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      edited_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comment_reactions (
      comment_id INTEGER NOT NULL REFERENCES card_comments(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(10) NOT NULL,
      PRIMARY KEY (comment_id, user_id, emoji)
    )
  `);

  await pool.query(`
    ALTER TABLE card_comments ADD COLUMN IF NOT EXISTS image_url TEXT
  `);

  // Upload ledger — one row per stored Spaces object, used to enforce the
  // per-user storage cap (SUM(bytes) WHERE user_id). Rows are removed by
  // deleteSpacesImages() whenever the underlying object is deleted.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS uploads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL UNIQUE,
      bytes BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS uploads_user_idx ON uploads(user_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guilds (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      icon_color TEXT NOT NULL DEFAULT 'arcane',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_members (
      guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (guild_id, user_id)
    )
  `);
  // when a member joined — powers the "joined a guild" entry in Cosmic Activity
  await pool.query(`
    ALTER TABLE guild_members ADD COLUMN IF NOT EXISTS joined_at TIMESTAMPTZ DEFAULT NOW()
  `);

  await pool.query(`
    ALTER TABLE boards ADD COLUMN IF NOT EXISTS guild_id INTEGER REFERENCES guilds(id) ON DELETE SET NULL
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_invites (
      id SERIAL PRIMARY KEY,
      guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
      inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invitee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, invitee_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      data JSONB NOT NULL DEFAULT '{}',
      read BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Per-board activity log for the notification bell. card_id is nullable with
  // ON DELETE SET NULL so a "deleted" entry survives the card it refers to;
  // card_title is denormalised so the log still reads sensibly afterwards.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS card_activity (
      id SERIAL PRIMARY KEY,
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action VARCHAR(20) NOT NULL,
      card_title VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS card_activity_board_idx ON card_activity (board_id, created_at DESC)
  `);

  // Board-level activity (rename / delete) for the owner's Cosmic Activity feed.
  // Intentionally NOT foreign-keyed to boards: a "deleted" entry must outlive
  // the board it describes, so board_id is a bare reference and board_title /
  // detail are denormalised so the row reads on its own.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_activity (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      board_id INTEGER,
      action VARCHAR(20) NOT NULL,
      board_title VARCHAR(255),
      detail VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS board_activity_user_idx ON board_activity (user_id, created_at DESC)
  `);

  // The label/tag feature was removed; drop the table so no stale data lingers.
  await pool.query(`DROP TABLE IF EXISTS labels`);
}

// JSON error handler — multer upload errors (size/type) map to 400; anything
// else is an unexpected server error.
app.use((err, req, res, next) => {
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "Image is too large (max 5 MB)" });
  }
  if (err instanceof multer.MulterError || /image files are allowed/i.test(err.message || "")) {
    return res.status(400).json({ error: err.message || "Upload failed" });
  }
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

const PORT = process.env.PORT || 4000;
migrate().then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)));
