import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { parseMessage } from "./parser.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(cors());
app.use(express.json());

async function autoMigrate() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      nome TEXT,
      plano TEXT,
      status TEXT,
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      phone TEXT UNIQUE,
      verificado BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS financial_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      tipo TEXT,
      valor NUMERIC,
      categoria TEXT,
      descricao TEXT,
      data DATE,
      vencimento DATE,
      status TEXT,
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      titulo TEXT,
      tipo TEXT,
      data DATE,
      hora TIME,
      recorrente TEXT,
      status TEXT DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_id UUID REFERENCES events(id),
      minutos_antes INT,
      enviado BOOLEAN DEFAULT false,
      enviado_em TIMESTAMP
    );
  `);

  console.log("Atlas DB OK");
}

// roda antes de tudo
await autoMigrate();
startScheduler();

// Kiwify webhook
app.post("/webhook/kiwify", async (req, res) => {
  const { email, nome, plano, status } = req.body;

  await pool.query(
    `INSERT INTO users (email,nome,plano,status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email)
     DO UPDATE SET plano=$3, status=$4`,
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
