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

// ===================== ADMIN AUTH =====================
function mustAdmin(req, res) {
  const k = (req.headers["x-admin-key"] || "").toString();
  const expected = (process.env.ADMIN_KEY || "").toString();
  if (!expected || k !== expected) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

// ===================== AUTO MIGRATE =====================
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

    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT,
      titulo TEXT,
      descricao TEXT,
      data DATE,
      hora TIME,
      status TEXT DEFAULT 'pending',
      notificado BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS financeiro (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT CHECK (tipo IN ('income', 'expense')),
      descricao TEXT,
      valor DECIMAL(10,2),
      data DATE,
      categoria TEXT,
      pago BOOLEAN DEFAULT false,
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
  console.log("✅ Banco de dados migrado");
}

await autoMigrate();
startScheduler();

// ===================== API =====================
const api = express.Router();

// Health check
api.get("/health", (req, res) => res.json({ ok: true }));

// ===================== ADMIN =====================
api.get("/admin/users", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  try {
    const result = await pool.query(`
      SELECT u.*, wn.phone 
      FROM users u
      LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
      ORDER BY u.criado_em DESC
    `);
    res.json({ users: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  try {
    const result = await pool.query(
      `SELECT u.*, wn.phone FROM users u
       LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/admin/users", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  const { email, nome, plano, status, phone } = req.body;
  
  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    
    const userResult = await client.query(
      `INSERT INTO users (email, nome, plano, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET nome = $2, plano = $3, status = $4
       RETURNING *`,
      [email.toLowerCase(), nome, plano || 'FREE', status || 'active']
    );
    
    const user = userResult.rows[0];
    
    if (phone) {
      await client.query(
        `INSERT INTO whatsapp_numbers (user_id, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET user_id = $1`,
        [user.id, phone]
      );
    }
    
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.put("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  const { email, nome, plano, status, phone } = req.body;
  
  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    
    await client.query(
      `UPDATE users SET email = $1, nome = $2, plano = $3, status = $4
       WHERE id = $5`,
      [email.toLowerCase(), nome, plano, status, req.params.id]
    );
    
    if (phone) {
      await client.query(
        `INSERT INTO whatsapp_numbers (user_id, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET user_id = $1`,
        [req.params.id, phone]
      );
    }
    
    await client.query('COMMIT');
    client.release();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/admin/users/:id", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== DASHBOARD DATA =====================
api.get("/admin/dashboard/:userId?", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  
  const userId = req.params.userId;
  const whereClause = userId ? 'WHERE user_id = $1' : '';
  const params = userId ? [userId] : [];
  
  try {
    // Eventos
    const eventsResult = await pool.query(`
      SELECT * FROM events ${whereClause}
      ORDER BY data, hora
      LIMIT 20
    `, params);
    
    // Finanças
    const financeResult = await pool.query(`
      SELECT * FROM financeiro ${whereClause}
      ORDER BY data DESC
      LIMIT 20
    `, params);
    
    // Resumo financeiro
    const summaryResult = await pool.query(`
      SELECT 
        tipo,
        COUNT(*) as count,
        SUM(valor) as total
      FROM financeiro ${whereClause}
      GROUP BY tipo
    `, params);
    
    res.json({
      events: eventsResult.rows,
      finances: financeResult.rows,
      summary: summaryResult.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SIMULADOR WHATSAPP =====================
api.post("/simulator/whatsapp", async (req, res) => {
  if (!mustAdmin(req, res)) return;
  
  const { from, message } = req.body;
  const parsed = parseMessage(message || "");
  
  try {
    const client = await pool.connect();
    await client.query('BEGIN');
    
    // 1. Encontrar usuário pelo telefone
    const userResult = await client.query(`
      SELECT u.* FROM users u
      JOIN whatsapp_numbers wn ON wn.user_id = u.id
      WHERE wn.phone = $1
    `, [from]);
    
    let userId = userResult.rows[0]?.id;
    
    // Se não encontrou, criar usuário temporário
    if (!userId) {
      const newUser = await client.query(
        `INSERT INTO users (email, nome, plano, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [`${from}@temp.com`, `Usuário ${from}`, 'FREE', 'active']
      );
      userId = newUser.rows[0].id;
      
      await client.query(
        `INSERT INTO whatsapp_numbers (user_id, phone)
         VALUES ($1, $2)`,
        [userId, from]
      );
    }
    
    // 2. Salvar mensagem
    const reply = `✅ Entendido! ${parsed.tipo === 'expense' ? 'Despesa registrada' : 
                    parsed.tipo === 'income' ? 'Receita registrada' : 
                    'Evento agendado'}`;
    
    await client.query(
      `INSERT INTO messages (channel, from_phone, text, parsed, reply)
       VALUES ('simulator', $1, $2, $3, $4)`,
      [from, message, JSON.stringify(parsed), reply]
    );
    
    // 3. Salvar no banco conforme o tipo
    if (parsed.tipo === 'expense' || parsed.tipo === 'income') {
      await client.query(
        `INSERT INTO financeiro (user_id, tipo, descricao, valor, data, pago)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, parsed.tipo, parsed.descricao || message, 
         parsed.valor, parsed.data || new Date().toISOString().split('T')[0],
         parsed.tipo === 'income']
      );
    }
    
    if (parsed.tipo === 'event') {
      await client.query(
        `INSERT INTO events (user_id, tipo, titulo, descricao, data, hora, status)
         VALUES ($1, 'appointment', $2, $3, $4, $5, 'pending')`,
        [userId, parsed.titulo || parsed.descricao || message,
         parsed.descricao || message, parsed.data, parsed.hora]
      );
    }
    
    await client.query('COMMIT');
    client.release();
    
    res.json({ 
      ok: true, 
      reply,
      parsed,
      userId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== ROTAS PÚBLICAS (login) =====================
api.post("/auth/request", async (req, res) => {
  const { email } = req.body;
  
  try {
    // Gerar código
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60000); // 15 minutos
    
    // Verificar se usuário existe
    let userResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
    
    let userId;
    if (userResult.rows.length === 0) {
      // Criar usuário se não existir
      const newUser = await pool.query(
        `INSERT INTO users (email, nome, plano, status)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [email.toLowerCase(), email.split('@')[0], 'FREE', 'active']
      );
      userId = newUser.rows[0].id;
    } else {
      userId = userResult.rows[0].id;
    }
    
    // Salvar código
    await pool.query(
      `INSERT INTO login_codes (user_id, code, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, code, expiresAt]
    );
    
    // Em produção, enviaria email. Aqui só retorna.
    res.json({ ok: true, code: code }); // DEBUG: retorna código
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/auth/verify", async (req, res) => {
  const { email, code } = req.body;
  
  try {
    const result = await pool.query(
      `SELECT lc.*, u.id as user_id 
       FROM login_codes lc
       JOIN users u ON u.id = lc.user_id
       WHERE u.email = $1 AND lc.code = $2 
       AND lc.expires_at > NOW() AND lc.used = false`,
      [email.toLowerCase(), code]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Código inválido ou expirado" });
    }
    
    // Marcar código como usado
    await pool.query(
      'UPDATE login_codes SET used = true WHERE id = $1',
      [result.rows[0].id]
    );
    
    // Gerar token
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60000); // 7 dias
    
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [result.rows[0].user_id, token, expiresAt]
    );
    
    res.json({ ok: true, token });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SETUP =====================
app.use("/api", api);
app.use(express.static(__dirname));
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Atlas rodando na porta ${PORT}`);
});
