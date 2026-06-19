import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import pool from "./database.js";

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

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());
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

async function isOwner(userId, boardId) {
  const result = await pool.query(
    "SELECT 1 FROM boards WHERE id = $1 AND owner_id = $2",
    [boardId, userId]
  );
  return result.rowCount > 0;
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

  const existing = await pool.query(
    "SELECT id FROM users WHERE username = $1 OR email = $2",
    [username.trim(), email.trim()]
  );
  if (existing.rowCount > 0) {
    return res.status(409).json({ error: "Username or email already taken" });
  }

  const password_hash = await bcrypt.hash(password, 10);
  const result = await pool.query(
    "INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email",
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

  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  req.session.userId = user.id;
  res.json({ id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url ?? null });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const result = await pool.query(
    "SELECT id, username, email, avatar_url FROM users WHERE id = $1",
    [req.session.userId]
  );
  if (!result.rows[0]) return res.status(401).json({ error: "Unauthorized" });
  res.json(result.rows[0]);
});

// PATCH /api/users/me — update avatar (preset key or uploaded image path)
app.patch("/api/users/me", requireAuth, async (req, res) => {
  const { avatar_url } = req.body;
  const result = await pool.query(
    "UPDATE users SET avatar_url = $1 WHERE id = $2 RETURNING id, username, email, avatar_url",
    [avatar_url ?? null, req.session.userId]
  );
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
      jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url)
                ORDER BY (u.id <> b.owner_id), u.username),
      '[]'::jsonb)
    FROM users u
    WHERE u.id = b.owner_id
       OR u.id IN (SELECT user_id FROM board_members WHERE board_id = b.id)
  )`;
  const result = await pool.query(
    `SELECT b.*, 'owner' AS role, ba.accessed_at AS last_accessed_at,
            g.name AS guild_name, g.icon_color AS guild_icon_color,
            ${columnCounts} AS column_counts, ${members} AS members
       FROM boards b
       LEFT JOIN board_access ba ON ba.board_id = b.id AND ba.user_id = $1
       LEFT JOIN guilds g ON g.id = b.guild_id
       WHERE b.owner_id = $1
     UNION
     SELECT b.*, 'member' AS role, ba.accessed_at AS last_accessed_at,
            g.name AS guild_name, g.icon_color AS guild_icon_color,
            ${columnCounts} AS column_counts, ${members} AS members
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

app.patch("/api/boards/:id", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  // partial update: only the provided fields change (title and/or the
  // decorative background). background_image may be set to null to clear it.
  const { title, background_image, background_opacity } = req.body;
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
  values.push(req.params.id);
  const result = await pool.query(
    `UPDATE boards SET ${sets.join(", ")} WHERE id = $${i} RETURNING *`,
    values
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
  const members = `(
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('id', u.id, 'username', u.username, 'avatar_url', u.avatar_url)
                ORDER BY (u.id <> b.owner_id), u.username),
      '[]'::jsonb)
    FROM users u
    WHERE u.id = b.owner_id
       OR u.id IN (SELECT user_id FROM board_members WHERE board_id = b.id)
  )`;
  const result = await pool.query(
    `SELECT b.*,
       CASE WHEN b.owner_id = $2 THEN 'owner' ELSE 'member' END AS role,
       ba.accessed_at AS last_accessed_at,
       ${columnCounts} AS column_counts,
       ${members} AS members
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
  res.json({ ...card, label_name: label_name || null, label_color: label_color || null, created_by_username: user.rows[0]?.username || null });
});

app.delete("/api/cards/:id", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
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
    return res.json({ ...result.rows[0], label_name: label_name || null, label_color: label_color || null, last_edited_by_username: editor.rows[0]?.username || null });
  }

  if (track_edit) {
    const result = await pool.query(
      "UPDATE cards SET column_id = $1, position = $2, last_edited_by = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
      [column_id, position, req.session.userId, req.params.id]
    );
    const editor = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
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

  await pool.query(`
    ALTER TABLE boards ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)
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
}

// JSON error handler — covers multer upload errors (size/type)
app.use((err, req, res, next) => {
  const message = err.code === "LIMIT_FILE_SIZE"
    ? "Image is too large (max 5 MB)"
    : err.message || "Upload failed";
  res.status(400).json({ error: message });
});

const PORT = process.env.PORT || 4000;
migrate().then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)));
