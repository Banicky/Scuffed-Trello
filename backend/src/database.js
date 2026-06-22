// imports Postgres library 

import pg from "pg";

// uses Pool class since its allegedly more efficient for multiple queries
// pool = holds multiple clients
const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Surface idle-client errors instead of crashing the process silently.
pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

export default pool;