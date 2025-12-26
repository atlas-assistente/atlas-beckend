import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { parseMessage } from "./parser.js";
import { startScheduler } from "./scheduler.js";

const app = express();
app.use(cors());
app.use(express.json());

function mustAdmin(req, res) {
  const k = (req.headers["x-admin-key"] || "").toString();
  const expected = (process.env.ADMIN_KEY || "").toString();
  if (!expected || k !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

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

    CREATE TABLE IF NOT EXISTS financial_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
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
      event_id UUID REFERENCES events(id) ON DELETE CASCADE,
      minutos_antes INT,
      enviado BOOLEAN DEFAULT false,
      enviado_em TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      channel TEXT DEFAULT 'simulator',
      from_phone TEXT,
      text TEXT,
      parsed JSONB,
      reply TEXT,
      criado_em TIMESTAMP DEFAULT now()
    );
  `);

  console.log("Atlas DB OK");
}

await autoMigrate();
startScheduler();

app.get("/", (req, res) => res.send("Atlas Online"));
app.get("/health", (req, res) => res.json({ ok: true }));

// -------------------------
// ADMIN USERS (REAL)
// -------------------------
app.get("/admin/users", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const q = `
    SELECT
      u.id, u.email, u.nome, u.plano, u.status, u.criado_em,
      wn.phone
    FROM users u
    LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
    ORDER BY u.criado_em DESC
  `;
  const r = await pool.query(q);
  res.json({ users: r.rows });
});

app.get("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { id } = req.params;
  const q = `
    SELECT
      u.id, u.email, u.nome, u.plano, u.status, u.criado_em,
      wn.phone
    FROM users u
    LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
  `;
  const r = await pool.query(q, [id]);
  if (!r.rows.length) return res.status(404).json({ error: "Usuário não encontrado" });
  res.json({ user: r.rows[0] });
});

app.post("/admin/users", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { email, nome, plano, status, phone } = req.body || {};
  if (!email) return res.status(400).json({ error: "email obrigatório" });

  const up = await pool.query(
    `INSERT INTO users (email, nome, plano, status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email)
     DO UPDATE SET nome=$2, plano=$3, status=$4
     RETURNING id, email, nome, plano, status`,
    [String(email).toLowerCase(), nome || null, plano || "FREE", status || "active"]
  );

  const user = up.rows[0];

  if (phone && String(phone).trim() !== "") {
    await pool.query(
      `INSERT INTO whatsapp_numbers (user_id, phone, verificado)
       VALUES ($1,$2,false)
       ON CONFLICT (phone)
       DO UPDATE SET user_id=$1`,
      [user.id, String(phone).trim()]
    );
  }

  res.json({ ok: true, user });
});

app.put("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { id } = req.params;
  const { email, nome, plano, status, phone } = req.body || {};

  const current = await pool.query(`SELECT id, email FROM users WHERE id=$1`, [id]);
  if (!current.rows.length) return res.status(404).json({ error: "Usuário não encontrado" });

  const nextEmail = email ? String(email).toLowerCase() : current.rows[0].email;

  const up = await pool.query(
    `UPDATE users
     SET email=$1, nome=$2, plano=$3, status=$4
     WHERE id=$5
     RETURNING id, email, nome, plano, status`,
    [nextEmail, nome || null, plano || "FREE", status || "active", id]
  );

  if (phone !== undefined) {
    const p = String(phone || "").trim();
    if (p === "") {
      await pool.query(`DELETE FROM whatsapp_numbers WHERE user_id=$1`, [id]);
    } else {
      await pool.query(
        `INSERT INTO whatsapp_numbers (user_id, phone, verificado)
         VALUES ($1,$2,false)
         ON CONFLICT (phone)
         DO UPDATE SET user_id=$1`,
        [id, p]
      );
    }
  }

  res.json({ ok: true, user: up.rows[0] });
});

app.delete("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { id } = req.params;
  await pool.query(`DELETE FROM users WHERE id=$1`, [id]);
  res.json({ ok: true });
});

// -------------------------
// KIWIFY WEBHOOK (já pronto p/ depois)
// -------------------------
app.post("/webhook/kiwify", async (req, res) => {
  const { email, nome, plano, status } = req.body || {};
  if (!email) return res.status(400).json({ error: "email ausente" });

  await pool.query(
    `INSERT INTO users (email,nome,plano,status)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (email)
     DO UPDATE SET nome=$2, plano=$3, status=$4`,
    [String(email).toLowerCase(), nome || null, plano || "FREE", status || "active"]
  );

  res.send("OK");
});

// -------------------------
// WHATSAPP REAL (futuro)
// -------------------------
app.post("/webhook/whatsapp", async (req, res) => {
  const { from, message } = req.body || {};
  const parsed = parseMessage(message || "");

  console.log("📲", from, parsed);
  res.json({ reply: "Registrado no Atlas." });
});

// -------------------------
// SIMULADOR WHATSAPP (FAKE) - REALMENTE GRAVA
// Exige ADMIN_KEY para evitar expor seu banco publicamente
// -------------------------
app.post("/simulator/whatsapp", async (req, res) => {
  if (!mustAdmin(req, res)) return;

  const { from, message } = req.body || {};
  const parsed = parseMessage(message || "");

  // Buscar usuário pelo telefone
  const userRes = await pool.query(
    `SELECT u.id, u.email
     FROM whatsapp_numbers wn
     JOIN users u ON u.id = wn.user_id
     WHERE wn.phone = $1
     LIMIT 1`,
    [String(from)]
  );

  if (!userRes.rows.length) {
    const reply = "Este número não está vinculado a nenhum usuário Atlas.";
    await pool.query(
      `INSERT INTO messages (channel, from_phone, text, parsed, reply)
       VALUES ('simulator', $1, $2, $3, $4)`,
      [String(from || ""), String(message || ""), JSON.stringify(parsed || {}), reply]
    );
    return res.json({ reply });
  }

  const userId = userRes.rows[0].id;
  let reply = "Mensagem registrada.";

  // FINANCEIRO
  if (parsed.tipo === "expense" || parsed.tipo === "income") {
    await pool.query(
      `INSERT INTO financial_records (user_id, tipo, valor, descricao, data, vencimento, status)
       VALUES ($1,$2,$3,$4,$5,$6,'aberto')`,
      [
        userId,
        parsed.tipo,
        parsed.valor || 0,
        parsed.descricao,
        parsed.data,
        parsed.vencimento
      ]
    );

    reply = parsed.tipo === "expense"
      ? "Despesa registrada."
      : "Receita registrada.";
  }

  // EVENTO / AGENDA
  if (parsed.tipo === "event") {
    const ev = await pool.query(
      `INSERT INTO events (user_id, titulo, data, hora)
       VALUES ($1,$2,$3,$4)
       RETURNING id`,
      [userId, parsed.titulo, parsed.data, parsed.hora]
    );

    if (parsed.data) {
      await pool.query(
        `INSERT INTO reminders (event_id, minutos_antes)
         VALUES ($1, 1440)`,
        [ev.rows[0].id]
      );
    }

    reply = "Evento registrado na agenda.";
  }

  await pool.query(
    `INSERT INTO messages (channel, user_id, from_phone, text, parsed, reply)
     VALUES ('simulator', $1, $2, $3, $4, $5)`,
    [userId, String(from || ""), String(message || ""), JSON.stringify(parsed || {}), reply]
  );

  res.json({ reply, parsed });
});


app.listen(process.env.PORT || 3000);
