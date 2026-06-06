import "dotenv/config";
import express from "express";
import cors from "cors";
import pool from "./database.js";

const app = express();

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// Health
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// fetches boards from db ordered by id
app.get("/api/boards", async (req, res) => {
  const result = await pool.query("SELECT * FROM boards ORDER BY id");
  res.json(result.rows);
});

// creates new board with title from request body and returns the created board
app.post("/api/boards", async (req, res) => {
  const { title } = req.body;
  const result = await pool.query(
    "INSERT INTO boards (title) VALUES ($1) RETURNING *",
    [title]
  );
  res.json(result.rows[0]);
});

// Fetch a specific board (entire dashboard) by id
app.get("/api/boards/:id", async (req, res) => {
  const result = await pool.query("SELECT * FROM boards WHERE id = $1", [req.params.id]);
  res.json(result.rows[0]);
});

// Updates board-related info (Ex. board name)
app.patch("/api/boards/:id", async (req, res) => {
  const { title } = req.body;
  const result = await pool.query(
    "UPDATE boards SET title = $1 WHERE id = $2 RETURNING *",
    [title, req.params.id]
  );
  res.json(result.rows[0]);
});

// deletes board with specified id
app.delete("/api/boards/:id", async (req, res) => {
  await pool.query("DELETE FROM boards WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// fetches all columns beloging to a board ordered by position, boardId is from url parameter
app.get("/api/boards/:boardId/columns", async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM columns WHERE board_id = $1 ORDER BY position",
    [req.params.boardId]
  );
  res.json(result.rows);
});

// creates new column with title, position and board_id from request body and returns the created column
app.post("/api/columns", async (req, res) => {
  const { board_id, title, position } = req.body;
  const result = await pool.query(
    "INSERT INTO columns (board_id, title, position) VALUES ($1, $2, $3) RETURNING *",
    [board_id, title, position]
  );
  res.json(result.rows[0]);
});

// deletes column with specified id
app.delete("/api/columns/:id", async (req, res) => {
  await pool.query("DELETE FROM columns WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

app.patch("/api/columns/:id", async (req, res) => {
  const { title } = req.body;
  const result = await pool.query(
    "UPDATE columns SET title = $1 WHERE id = $2 RETURNING *",
    [title, req.params.id]
  );
  res.json(result.rows[0]);
});

// card routes
// uses LEFT JOIN to fetch cards and labels in one query ordered by position otherwise need to make separate req for every label
app.get("/api/columns/:columnId/cards", async (req, res) => {
  const result = await pool.query(
    `SELECT cards.*, labels.name AS label_name, labels.color AS label_color
     FROM cards
     LEFT JOIN labels ON labels.card_id = cards.id
     WHERE cards.column_id = $1
     ORDER BY cards.position`,
    [req.params.columnId]
  );
  res.json(result.rows);
});

// creates card by inserting into cards table then if label provided, inserts into labels table
app.post("/api/cards", async (req, res) => {
  const { column_id, title, description, position, label_name, label_color } = req.body;

  const cardResult = await pool.query(
    "INSERT INTO cards (column_id, title, description, position) VALUES ($1, $2, $3, $4) RETURNING *",
    [column_id, title, description, position]
  );

  const card = cardResult.rows[0];

  if (label_name) {
    await pool.query(
      "INSERT INTO labels (card_id, name, color) VALUES ($1, $2, $3)",
      [card.id, label_name, label_color]
    );
  }

  res.json({ ...card, label_name: label_name || null, label_color: label_color || null });
});

app.delete("/api/cards/:id", async (req, res) => {
  await pool.query("DELETE FROM cards WHERE id = $1", [req.params.id]);
  res.json({ success: true });
});

// PATCH /api/cards/:id  — move card, toggle starred, or edit content
app.patch('/api/cards/:id', async (req, res) => {
  const { column_id, position, starred, title, description, label_name, label_color } = req.body;

  if (starred !== undefined) {
    const result = await pool.query(
      'UPDATE cards SET starred = $1 WHERE id = $2 RETURNING *',
      [starred, req.params.id]
    );
    return res.json(result.rows[0]);
  }

  if (title !== undefined) {
    const result = await pool.query(
      'UPDATE cards SET title = $1, description = $2 WHERE id = $3 RETURNING *',
      [title, description || null, req.params.id]
    );
    await pool.query('DELETE FROM labels WHERE card_id = $1', [req.params.id]);
    if (label_name) {
      await pool.query(
        'INSERT INTO labels (card_id, name, color) VALUES ($1, $2, $3)',
        [req.params.id, label_name, label_color]
      );
    }
    return res.json({ ...result.rows[0], label_name: label_name || null, label_color: label_color || null });
  }

  const result = await pool.query(
    'UPDATE cards SET column_id = $1, position = $2 WHERE id = $3 RETURNING *',
    [column_id, position, req.params.id]
  );
  res.json(result.rows[0]);
});


// Run any pending schema migrations before accepting requests
async function migrate() {
  await pool.query(`
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false
  `);
}

const PORT = process.env.PORT || 4000;
migrate().then(() => app.listen(PORT, () => console.log(`Server running on port ${PORT}`)));