import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import bcrypt from "bcrypt";
import multer from "multer";
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
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, unique + path.extname(file.originalname).toLowerCase());
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

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

// helper: check if user owns or is a member of the board
async function canAccessBoard(userId, boardId) {
  const result = await pool.query(
    `SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2
     UNION
     SELECT 1 FROM board_members WHERE board_id = $1 AND user_id = $2`,
    [boardId, userId]
  );
  return result.rowCount > 0;
}

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
  } catch (err) {
    // Activity logging is best-effort — never fail the underlying card action.
    console.error("logActivity failed:", err.message);
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
  res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, totp_enabled: user.totp_enabled });
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
  res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url, totp_enabled: true });
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
    "SELECT id, username, email, avatar_url, totp_enabled FROM users WHERE id = $1",
    [req.session.userId]
  );
  if (!result.rows[0]) return res.status(401).json({ error: "Unauthorized" });
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

  values.push(req.session.userId);
  const result = await pool.query(
    `UPDATE users SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, username, email, avatar_url`,
    values
  );
  res.json(result.rows[0]);
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
  // per-board ordered list of card counts per column, for the tile previews
  const columnCounts = `(
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
  const members = `(
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username)
                ORDER BY (u.id <> b.owner_id), u.username),
      '[]'::jsonb)
    FROM users u
    WHERE u.id = b.owner_id
       OR u.id IN (SELECT user_id FROM board_members WHERE board_id = b.id)
  )`;
  const result = await pool.query(
    `SELECT b.*, 'owner' AS role, ba.accessed_at AS last_accessed_at, ${columnCounts} AS column_counts, ${members} AS members
       FROM boards b
       LEFT JOIN board_access ba ON ba.board_id = b.id AND ba.user_id = $1
       WHERE b.owner_id = $1
     UNION
     SELECT b.*, 'member' AS role, ba.accessed_at AS last_accessed_at, ${columnCounts} AS column_counts, ${members} AS members
       FROM boards b
       JOIN board_members bm ON bm.board_id = b.id
       LEFT JOIN board_access ba ON ba.board_id = b.id AND ba.user_id = $1
       WHERE bm.user_id = $1
     ORDER BY id`,
    [req.session.userId]
  );
  res.json(result.rows);
});

app.post("/api/boards", requireAuth, async (req, res) => {
  const { title } = req.body;
  if (tooLong(title, 255)) return res.status(400).json({ error: "Title must be 255 characters or fewer" });
  const result = await pool.query(
    "INSERT INTO boards (title, owner_id) VALUES ($1, $2) RETURNING *",
    [title, req.session.userId]
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
              SELECT jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'color', c.color) ORDER BY c.position)
              FROM (
                SELECT cards.id, cards.title, cards.position, labels.color
                FROM cards LEFT JOIN labels ON labels.card_id = cards.id
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
  const { title } = req.body;
  if (tooLong(title, 255)) return res.status(400).json({ error: "Title must be 255 characters or fewer" });
  const result = await pool.query(
    "UPDATE boards SET title = $1 WHERE id = $2 RETURNING *",
    [title, req.params.id]
  );
  res.json(result.rows[0]);
});

app.delete("/api/boards/:id", requireAuth, async (req, res) => {
  if (!await isOwner(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Only the board owner can delete it" });
  }
  await pool.query("DELETE FROM boards WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// ── Board members ─────────────────────────────────────────────────────────────

app.get("/api/boards/:boardId/members", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.boardId)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const result = await pool.query(
    `SELECT u.id, u.username, u.email FROM users u
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
    `SELECT cards.*, labels.name AS label_name, labels.color AS label_color,
            creator.username AS created_by_username,
            editor.username AS last_edited_by_username,
            (SELECT COUNT(*)::int FROM card_comments cc WHERE cc.card_id = cards.id) AS comment_count
     FROM cards
     LEFT JOIN labels ON labels.card_id = cards.id
     LEFT JOIN users creator ON creator.id = cards.created_by
     LEFT JOIN users editor ON editor.id = cards.last_edited_by
     WHERE cards.column_id = $1
     ORDER BY cards.position`,
    [req.params.columnId]
  );
  res.json(result.rows);
});

app.post("/api/cards", requireAuth, async (req, res) => {
  const { column_id, title, description, position, label_name, label_color, image_url } = req.body;
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

  if (label_name) {
    await pool.query(
      "INSERT INTO labels (card_id, name, color) VALUES ($1, $2, $3)",
      [card.id, label_name, label_color]
    );
  }

  const user = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
  await logActivity({ boardId: col.rows[0].board_id, cardId: card.id, userId: req.session.userId, action: "created", cardTitle: card.title });
  res.json({ ...card, label_name: label_name || null, label_color: label_color || null, created_by_username: user.rows[0]?.username || null });
});

app.delete("/api/cards/:id", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id, cards.title FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  await logActivity({ boardId: card.rows[0].board_id, cardId: req.params.id, userId: req.session.userId, action: "deleted", cardTitle: card.rows[0].title });
  await pool.query("DELETE FROM cards WHERE id = $1", [req.params.id]);
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

  const { column_id, position, starred, title, description, label_name, label_color, track_edit, image_url } = req.body;

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
    const result = await pool.query(
      "UPDATE cards SET title = $1, description = $2, last_edited_by = $3, updated_at = NOW(), image_url = $4 WHERE id = $5 RETURNING *",
      [title, description || null, req.session.userId, image_url || null, req.params.id]
    );
    await pool.query("DELETE FROM labels WHERE card_id = $1", [req.params.id]);
    if (label_name) {
      await pool.query(
        "INSERT INTO labels (card_id, name, color) VALUES ($1, $2, $3)",
        [req.params.id, label_name, label_color]
      );
    }
    const editor = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
    await logActivity({ boardId: card.rows[0].board_id, cardId: req.params.id, userId: req.session.userId, action: "edited", cardTitle: result.rows[0].title });
    return res.json({ ...result.rows[0], label_name: label_name || null, label_color: label_color || null, last_edited_by_username: editor.rows[0]?.username || null });
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
    `SELECT cc.*, u.username,
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

// POST /api/upload — store an uploaded image and return its public URL
app.post("/api/upload", requireAuth, upload.single("image"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No image uploaded" });
  res.json({ url: `/uploads/${req.file.filename}` });
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
  const comment = await pool.query("SELECT user_id FROM card_comments WHERE id = $1", [req.params.id]);
  if (!comment.rows[0]) return res.status(404).json({ error: "Not found" });
  if (comment.rows[0].user_id !== req.session.userId) {
    return res.status(403).json({ error: "You can only delete your own comments" });
  }
  await pool.query("DELETE FROM card_comments WHERE id = $1", [req.params.id]);
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
}

// JSON error handler — covers multer upload errors (size/type)
app.use((err, req, res, next) => {
  const message = err.code === "LIMIT_FILE_SIZE"
    ? "Image is too large (max 5 MB)"
    : err.message || "Upload failed";
  res.status(400).json({ error: message });
});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS labels (
      id SERIAL PRIMARY KEY,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      name VARCHAR(100),
      color VARCHAR(50)
    )
  `);

const PORT = process.env.PORT || 4000;
migrate().then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)));
