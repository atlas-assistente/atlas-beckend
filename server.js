import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { parseMessage } from "./parser.js";
import { startScheduler } from "./scheduler.js";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcrypt";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

console.log("SERVER.JS REAL EXECUTANDO");


  async function mustUser(req, res) {
  const token = (req.headers["x-user-token"] || "").toString();

  if (!token) {
    res.status(401).json({ error: "Sem login" });
    return null;
  }

  const r = await pool.query(
    "SELECT user_id FROM sessions WHERE token=$1 AND expires_at > now()",
    [token]
  );

  if (!r.rows.length) {
    res.status(401).json({ error: "Login inválido" });
    return null;
  }

  return r.rows[0].user_id;
}

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

  // 1. Extensão
  await pool.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);

  // 2. Tabela users
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      password_hash TEXT,
      email TEXT UNIQUE NOT NULL,
      nome TEXT,
      plano TEXT DEFAULT 'FREE',
      status TEXT DEFAULT 'active',
      criado_em TIMESTAMP DEFAULT now()
    );
  `);

  // 3. REMOVE FK ANTIGA (a que trava o DELETE)
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'whatsapp_numbers_user_id_fkey'
      ) THEN
        ALTER TABLE whatsapp_numbers
        DROP CONSTRAINT whatsapp_numbers_user_id_fkey;
      END IF;
    END$$;
  `);

  // 4. whatsapp_numbers com CASCADE
  await pool.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_numbers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      phone TEXT UNIQUE,
      verificado BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT now()
    );
  `);

  // 5. messages
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel TEXT,
      from_phone TEXT,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      text TEXT,
      parsed JSONB,
      reply TEXT,
      criado_em TIMESTAMP DEFAULT now()
    );
  `);

  // 6. login_codes
  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_codes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      code TEXT,
      expires_at TIMESTAMP,
      used BOOLEAN DEFAULT false
    );
  `);

  // 7. sessions
  await pool.query(`
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

  const { email, nome, plano, status, phone, password } = req.body;
  if (!email) return res.status(400).json({ error: "email obrigatório" });

  let passwordHash = null;
  if (password) {
  passwordHash = await bcrypt.hash(password, 10);
  }


  const up = await pool.query(
    `INSERT INTO users (email,nome,plano,status,password_hash)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (email)
     DO UPDATE SET nome=$2, plano=$3, status=$4
     RETURNING id,email,nome,plano,status`,
    [email.toLowerCase(), nome || null, plano || "FREE", status || "active", passwordHash]
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

api.get("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { id } = req.params;

  const r = await pool.query(
    `
    SELECT u.id, u.email, u.nome, u.plano, u.status, wn.phone
    FROM users u
    LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
    WHERE u.id = $1
    `,
    [id]
  );

  if (!r.rows.length) {
    return res.status(404).json({ error: "Usuário não encontrado" });
  }

  res.json({ user: r.rows[0] });
});

api.put("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { id } = req.params;
  const { email, nome, plano, status, phone } = req.body;

  const up = await pool.query(
    `
    UPDATE users
    SET email=$1, nome=$2, plano=$3, status=$4
    WHERE id=$5
    RETURNING id,email,nome,plano,status
    `,
    [email.toLowerCase(), nome, plano, status, id]
  );

  if (!up.rows.length) {
    return res.status(404).json({ error: "Usuário não encontrado" });
  }

  if (phone) {
    await pool.query(
      `
      INSERT INTO whatsapp_numbers (user_id, phone)
      VALUES ($1,$2)
      ON CONFLICT (phone) DO UPDATE SET user_id=$1
      `,
      [id, phone]
    );
  }

  res.json({ ok: true, user: up.rows[0] });
});

api.delete("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { id } = req.params;

  await pool.query(`DELETE FROM users WHERE id=$1`, [id]);

  res.json({ ok: true });
});


// SIMULADOR WHATSAPP
api.post("/simulator/whatsapp", async (req, res) => {
  const userId = await mustUser(req, res);
  if (!userId) return;

  const { from, message } = req.body;
  const parsed = parseMessage(message || "");
  const reply = `Entendido: ${parsed?.tipo || "unknown"}`;

  await pool.query(
    `INSERT INTO messages (channel,from_phone,user_id,text,parsed,reply)
     VALUES ('simulator',$1,$2,$3,$4,$5)`,
    [from || "", userId, message || "", JSON.stringify(parsed || {}), reply]
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

api.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const r = await pool.query(
    "SELECT id, password_hash FROM users WHERE email=$1",
    [email.toLowerCase()]
  );

  if (!r.rows.length) return res.status(401).json({ error: "Credenciais inválidas" });

  const ok = await bcrypt.compare(password, r.rows[0].password_hash);
  if (!ok) return res.status(401).json({ error: "Credenciais inválidas" });

  const token = crypto.randomUUID();

  await pool.query(
    "INSERT INTO sessions (user_id, token, expires_at) VALUES ($1,$2, now() + interval '7 days')",
    [r.rows[0].id, token]
  );

  res.json({ token });
});


app.listen(process.env.PORT || 3000);

// =======================
// DASHBOARD DATA
// =======================

api.get("/dashboard/agenda", async (req, res) => {
  const userId = await mustUser(req, res);
  if (!userId) return;


  const r = await pool.query(`
    SELECT id, from_phone, parsed, text, criado_em
    FROM messages
    WHERE user_id = $1
    AND parsed->>'tipo' IN ('expense','income','event')
    ORDER BY criado_em DESC
    LIMIT 50
  `,[userId]);

  res.json({ items: r.rows });
});

api.get("/dashboard/finance", async (req, res) => {
  const userId = await mustUser(req, res);
  if (!userId) return;


  const r = await pool.query(`
    SELECT
      SUM(CASE WHEN parsed->>'tipo' = 'income' THEN (parsed->>'valor')::numeric ELSE 0 END) AS income,
      SUM(CASE WHEN parsed->>'tipo' = 'expense' THEN (parsed->>'valor')::numeric ELSE 0 END) AS expense
    FROM messages
    WHERE user_id = $1
  `,[userId]);

  res.json(r.rows[0]);
});

