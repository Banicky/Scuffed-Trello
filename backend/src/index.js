import "dotenv/config";
import express from "express";
import cors from "cors";

// App instance
const app = express();

// Allow cross origin requests from the specified url
app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));

// Parse JSON request bodies
app.use(express.json());

// Test endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Initializes the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
