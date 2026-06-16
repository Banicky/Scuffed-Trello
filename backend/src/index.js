import "dotenv/config";
import express from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import bcrypt from "bcrypt";
import pool from "./database.js";

const app = express();
const PgSession = connectPgSimple(session);

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173", credentials: true }));
app.use(express.json());
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
  res.json({ id: user.id, username: user.username, email: user.email });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/auth/me", async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Unauthorized" });
  const result = await pool.query(
    "SELECT id, username, email FROM users WHERE id = $1",
    [req.session.userId]
  );
  if (!result.rows[0]) return res.status(401).json({ error: "Unauthorized" });
  res.json(result.rows[0]);
});

// ── Boards ───────────────────────────────────────────────────────────────────

// returns boards owned by or shared with the logged-in user
app.get("/api/boards", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT b.*, 'owner' AS role FROM boards b WHERE b.owner_id = $1
     UNION
     SELECT b.*, 'member' AS role FROM boards b
       JOIN board_members bm ON bm.board_id = b.id
       WHERE bm.user_id = $1
     ORDER BY id`,
    [req.session.userId]
  );
  res.json(result.rows);
});

app.post("/api/boards", requireAuth, async (req, res) => {
  const { title } = req.body;
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
  const result = await pool.query("SELECT * FROM boards WHERE id = $1", [req.params.id]);
  res.json(result.rows[0]);
});

app.patch("/api/boards/:id", requireAuth, async (req, res) => {
  if (!await canAccessBoard(req.session.userId, req.params.id)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const { title } = req.body;
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
            COALESCE(
              (SELECT json_agg(jsonb_build_object('emoji', cr.emoji, 'userId', cr.user_id))
               FROM card_reactions cr WHERE cr.card_id = cards.id),
              '[]'::json
            ) AS reactions
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
  const { column_id, title, description, position, label_name, label_color } = req.body;
  const col = await pool.query("SELECT board_id FROM columns WHERE id = $1", [column_id]);
  if (!col.rows[0] || !await canAccessBoard(req.session.userId, col.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const cardResult = await pool.query(
    "INSERT INTO cards (column_id, title, description, position, created_by, updated_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *",
    [column_id, title, description, position, req.session.userId]
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

  const { column_id, position, starred, title, description, label_name, label_color, track_edit } = req.body;

  if (starred !== undefined) {
    const result = await pool.query(
      "UPDATE cards SET starred = $1 WHERE id = $2 RETURNING *",
      [starred, req.params.id]
    );
    return res.json(result.rows[0]);
  }

  if (title !== undefined) {
    const result = await pool.query(
      "UPDATE cards SET title = $1, description = $2, last_edited_by = $3, updated_at = NOW() WHERE id = $4 RETURNING *",
      [title, description || null, req.session.userId, req.params.id]
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

// POST /api/cards/:id/reactions — toggle an emoji reaction for the current user
app.post("/api/cards/:id/reactions", requireAuth, async (req, res) => {
  const card = await pool.query(
    "SELECT columns.board_id FROM cards JOIN columns ON columns.id = cards.column_id WHERE cards.id = $1",
    [req.params.id]
  );
  if (!card.rows[0] || !await canAccessBoard(req.session.userId, card.rows[0].board_id)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { emoji } = req.body;
  const existing = await pool.query(
    "SELECT 1 FROM card_reactions WHERE card_id = $1 AND user_id = $2 AND emoji = $3",
    [req.params.id, req.session.userId, emoji]
  );

  if (existing.rowCount > 0) {
    await pool.query(
      "DELETE FROM card_reactions WHERE card_id = $1 AND user_id = $2 AND emoji = $3",
      [req.params.id, req.session.userId, emoji]
    );
  } else {
    await pool.query(
      "INSERT INTO card_reactions (card_id, user_id, emoji) VALUES ($1, $2, $3)",
      [req.params.id, req.session.userId, emoji]
    );
  }

  const reactions = await pool.query(
    `SELECT emoji, user_id AS "userId" FROM card_reactions WHERE card_id = $1`,
    [req.params.id]
  );
  res.json({ reactions: reactions.rows });
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
    `SELECT cc.*, u.username FROM card_comments cc
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
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: "Comment body is required" });

  const result = await pool.query(
    "INSERT INTO card_comments (card_id, user_id, body) VALUES ($1, $2, $3) RETURNING *",
    [req.params.id, req.session.userId, body.trim()]
  );
  const user = await pool.query("SELECT username FROM users WHERE id = $1", [req.session.userId]);
  res.json({ ...result.rows[0], username: user.rows[0].username });
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
  res.json({ ...result.rows[0], username: user.rows[0].username });
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS board_members (
      board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
    CREATE TABLE IF NOT EXISTS card_reactions (
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji VARCHAR(10) NOT NULL,
      PRIMARY KEY (card_id, user_id, emoji)
    )
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
}

const PORT = process.env.PORT || 4000;
migrate().then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)));
