import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { parseMessage } from "./parser.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(cors());
app.use(express.json());

startScheduler();

// Kiwify webhook
app.post("/webhook/kiwify", async (req, res) => {
  const { email, nome, plano, status } = req.body;
  await pool.query(
    "INSERT INTO users (email,nome,plano,status) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET plano=$3, status=$4",
    [email, nome, plano, status]
  );
  res.send("OK");
});

// WhatsApp webhook
app.post("/webhook/whatsapp", async (req, res) => {
  const { from, message } = req.body;

  const parsed = parseMessage(message);

  console.log("📲", from, parsed);

  res.json({ reply: "Registrado no Atlas." });
});

app.get("/", (req, res) => res.send("Atlas Online"));

app.listen(process.env.PORT || 3000);
