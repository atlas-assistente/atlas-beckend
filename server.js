import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { parseMessage } from "./parser.js";
import { startScheduler } from "./scheduler.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

console.log("SERVER.JS REAL EXECUTANDO");


// =======================
// ADMIN AUTH
// =======================
function mustAdmin(req, res) {
  const k = (req.headers["x-admin-key"] || "").toString();
  const expected = (process.env.ADMIN_KEY || "").toString();
  if (!expected || k !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// =======================
// AUTO MIGRATE
// =======================
async function autoMigrate() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      nome TEXT,
      plano TEXT DEFAULT 'FREE',
      status TEXT DEFAULT 'active',
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS whatsapp_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT UNIQUE,
      verificado BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel TEXT,
      from_phone TEXT,
      text TEXT,
      parsed JSONB,
      reply TEXT,
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS login_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      code TEXT,
      expires_at TIMESTAMP,
      used BOOLEAN DEFAULT false
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE,
      criado_em TIMESTAMP DEFAULT now(),
      expires_at TIMESTAMP
    );
  `);

  console.log("Atlas DB OK");
}


await autoMigrate();
startScheduler();

// =======================
// API
// =======================
const api = express.Router();

api.get("/health", (req, res) => {
  res.json({ ok: true });
});

// ADMIN USERS
api.get("/admin/users", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const r = await pool.query(`
    SELECT u.id, u.email, u.nome, u.plano, u.status, wn.phone
    FROM users u
    LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
    ORDER BY u.criado_em DESC
  `);

  res.json({ users: r.rows });
});

api.post("/admin/users", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { email, nome, plano, status, phone } = req.body;
  if (!email) return res.status(400).json({ error: "email obrigatório" });

  const up = await pool.query(
    `INSERT INTO users (email,nome,plano,status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email)
     DO UPDATE SET nome=$2, plano=$3, status=$4
     RETURNING id,email,nome,plano,status`,
    [email.toLowerCase(), nome || null, plano || "FREE", status || "active"]
  );

  const user = up.rows[0];

  if (phone) {
    await pool.query(
      `INSERT INTO whatsapp_numbers (user_id,phone)
       VALUES ($1,$2)
       ON CONFLICT (phone) DO UPDATE SET user_id=$1`,
      [user.id, phone]
    );
  }

  res.json({ ok: true, user });
});

// SIMULADOR WHATSAPP
api.post("/simulator/whatsapp", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { from, message } = req.body;
  const parsed = parseMessage(message || "");
  const reply = `Entendido: ${parsed?.tipo || "unknown"}`;

  await pool.query(
    `INSERT INTO messages (channel,from_phone,text,parsed,reply)
     VALUES ('simulator',$1,$2,$3,$4)`,
    [from || "", message || "", JSON.stringify(parsed || {}), reply]
  );

  res.json({ reply, parsed });
});

// Registra a API
app.use("/api", api);

// =======================
// FRONTEND
// =======================
app.use(express.static(__dirname));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(process.env.PORT || 3000);
