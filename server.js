import express from "express";
import cors from "cors";
import { Pool } from "pg";
import crypto from "crypto";
import cron from "node-cron";

// Banco
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const app = express();
app.use(cors());
app.use(express.json());

// Migração
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
      expires_at TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      titulo TEXT NOT NULL,
      descricao TEXT,
      data DATE NOT NULL,
      hora TIME,
      status TEXT DEFAULT 'pending',
      notificado BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT now()
    );
    
    CREATE TABLE IF NOT EXISTS transacoes (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK (tipo IN ('income', 'expense')),
      descricao TEXT NOT NULL,
      valor DECIMAL(10,2) NOT NULL,
      categoria TEXT DEFAULT 'outros',
      data DATE NOT NULL,
      pago BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT now()
    );
    
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      from_phone TEXT,
      texto TEXT,
      parsed JSONB,
      resposta TEXT,
      canal TEXT DEFAULT 'simulator',
      criado_em TIMESTAMP DEFAULT now()
    );
  `);
  console.log("✅ Banco migrado");
}

await autoMigrate();

// Parser
function parseMessage(texto) {
  const t = texto.toLowerCase().trim();
  const valorMatch = t.match(/(\d+[.,]?\d*)/);
  const valor = valorMatch ? parseFloat(valorMatch[1].replace(",", ".")) : null;
  
  const dataMatch = t.match(/dia\s?(\d{1,2})/);
  let data = null;
  if (dataMatch) {
    const dia = parseInt(dataMatch[1]);
    const hoje = new Date();
    const mes = hoje.getMonth() + 1;
    const ano = hoje.getFullYear();
    data = `${ano}-${mes.toString().padStart(2, '0')}-${dia.toString().padStart(2, '0')}`;
  }
  
  const horaMatch = t.match(/(\d{1,2})[h:]/);
  const hora = horaMatch ? `${horaMatch[1].padStart(2, '0')}:00` : null;
  
  if (t.includes("pagar") || t.includes("pagamento") || t.includes("conta")) {
    return {
      tipo: "expense",
      descricao: texto,
      valor,
      data: data || new Date().toISOString().split('T')[0],
      categoria: "contas"
    };
  }
  
  if (t.includes("recebi") || t.includes("ganhei") || t.includes("salário")) {
    return {
      tipo: "income",
      descricao: texto,
      valor,
      data: data || new Date().toISOString().split('T')[0],
      categoria: "renda"
    };
  }
  
  if (t.includes("dia") || t.includes("médico") || t.includes("reunião")) {
    return {
      tipo: "event",
      titulo: texto,
      descricao: texto,
      data: data || new Date().toISOString().split('T')[0],
      hora
    };
  }
  
  return { tipo: "unknown", texto };
}

// Scheduler
function startScheduler() {
  cron.schedule("* * * * *", async () => {
    try {
      const hoje = new Date().toISOString().split('T')[0];
      const agora = new Date().toTimeString().split(':').slice(0, 2).join(':');
      
      const eventos = await pool.query(
        `SELECT e.*, u.email, wn.phone 
         FROM events e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
         WHERE e.data = $1 AND e.notificado = false
         AND (e.hora <= $2 OR e.hora IS NULL)
         AND e.status = 'pending'`,
        [hoje, agora]
      );
      
      for (const evento of eventos.rows) {
        await pool.query(
          `UPDATE events SET notificado = true WHERE id = $1`,
          [evento.id]
        );
        
        console.log(`🔔 Lembrete: ${evento.titulo} para ${evento.phone || evento.email}`);
      }
    } catch (err) {
      console.error("Erro scheduler:", err);
    }
  });
  console.log("⏰ Agendador iniciado");
}

startScheduler();

// Middleware Admin
function mustAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_KEY || "admin123";
  if (key === expected) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
}

// Middleware Auth
async function authenticate(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Token requerido" });
  
  try {
    const sessao = await pool.query(
      `SELECT s.*, u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token = $1 AND s.expires_at > NOW()`,
      [token]
    );
    
    if (sessao.rows.length === 0) {
      return res.status(401).json({ error: "Sessão expirada" });
    }
    
    req.user = sessao.rows[0];
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// API
const api = express.Router();

// Health
api.get("/health", (req, res) => res.json({ ok: true, time: new Date() }));

// Auth
api.post("/auth/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email requerido" });
    
    let user = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    
    let userId;
    if (user.rows.length === 0) {
      const novo = await pool.query(
        `INSERT INTO users (email, nome) VALUES ($1, $2) RETURNING id`,
        [email.toLowerCase(), email.split('@')[0]]
      );
      userId = novo.rows[0].id;
    } else {
      userId = user.rows[0].id;
    }
    
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60000);
    
    await pool.query(
      `INSERT INTO login_codes (user_id, code, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, code, expires]
    );
    
    console.log(`📧 Código para ${email}: ${code}`);
    res.json({ ok: true, code: code });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/auth/verify", async (req, res) => {
  try {
    const { email, code } = req.body;
    
    const result = await pool.query(
      `SELECT lc.*, u.id as user_id 
       FROM login_codes lc
       JOIN users u ON u.id = lc.user_id
       WHERE u.email = $1 AND lc.code = $2 
       AND lc.expires_at > NOW() AND lc.used = false`,
      [email.toLowerCase(), code]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Código inválido" });
    }
    
    await pool.query(
      "UPDATE login_codes SET used = true WHERE id = $1",
      [result.rows[0].id]
    );
    
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60000);
    
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [result.rows[0].user_id, token, expires]
    );
    
    res.json({ ok: true, token, userId: result.rows[0].user_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User
api.get("/user/profile", authenticate, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        nome: req.user.nome,
        plano: req.user.plano
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.get("/user/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const eventos = await pool.query(
      `SELECT * FROM events 
       WHERE user_id = $1 AND data >= CURRENT_DATE
       ORDER BY data, hora
       LIMIT 10`,
      [userId]
    );
    
    const transacoes = await pool.query(
      `SELECT * FROM transacoes 
       WHERE user_id = $1
       ORDER BY data DESC
       LIMIT 10`,
      [userId]
    );
    
    const resumo = await pool.query(
      `SELECT 
        tipo,
        COUNT(*) as quantidade,
        SUM(valor) as total
       FROM transacoes
       WHERE user_id = $1
       GROUP BY tipo`,
      [userId]
    );
    
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString().split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString().split('T')[0];
    
    const calendario = await pool.query(
      `SELECT data, COUNT(*) as eventos,
        ARRAY_AGG(titulo) as titulos
       FROM events
       WHERE user_id = $1 
       AND data BETWEEN $2 AND $3
       GROUP BY data
       ORDER BY data`,
      [userId, primeiroDia, ultimoDia]
    );
    
    res.json({
      eventos: eventos.rows,
      transacoes: transacoes.rows,
      resumo: resumo.rows,
      calendario: calendario.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/user/event", authenticate, async (req, res) => {
  try {
    const { titulo, descricao, data, hora } = req.body;
    const result = await pool.query(
      `INSERT INTO events (user_id, titulo, descricao, data, hora)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, titulo, descricao, data, hora]
    );
    res.json({ ok: true, evento: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/user/transacao", authenticate, async (req, res) => {
  try {
    const { tipo, descricao, valor, categoria, data } = req.body;
    const result = await pool.query(
      `INSERT INTO transacoes (user_id, tipo, descricao, valor, categoria, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.id, tipo, descricao, valor, categoria || 'outros', data]
    );
    res.json({ ok: true, transacao: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Simulador WhatsApp
api.post("/simulator/whatsapp", mustAdmin, async (req, res) => {
  try {
    const { from, message } = req.body;
    const parsed = parseMessage(message);
    
    let userResult = await pool.query(
      `SELECT u.id FROM users u
       JOIN whatsapp_numbers wn ON wn.user_id = u.id
       WHERE wn.phone = $1`,
      [from]
    );
    
    let userId;
    if (userResult.rows.length === 0) {
      const novoUser = await pool.query(
        `INSERT INTO users (email, nome) 
         VALUES ($1, $2) RETURNING id`,
        [`${from}@temp.com`, `Usuário ${from}`]
      );
      userId = novoUser.rows[0].id;
      
      await pool.query(
        `INSERT INTO whatsapp_numbers (user_id, phone) VALUES ($1, $2)`,
        [userId, from]
      );
    } else {
      userId = userResult.rows[0].id;
    }
    
    await pool.query(
      `INSERT INTO messages (user_id, from_phone, texto, parsed, canal)
       VALUES ($1, $2, $3, $4, 'simulator')`,
      [userId, from, message, JSON.stringify(parsed)]
    );
    
    let resposta = "✅ Recebido!";
    
    if (parsed.tipo === 'expense' || parsed.tipo === 'income') {
      await pool.query(
        `INSERT INTO transacoes (user_id, tipo, descricao, valor, categoria, data)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, parsed.tipo, parsed.descricao, parsed.valor, 
         parsed.categoria, parsed.data]
      );
      resposta = `✅ ${parsed.tipo === 'income' ? 'Receita' : 'Despesa'} registrada!`;
    }
    
    if (parsed.tipo === 'event') {
      await pool.query(
        `INSERT INTO events (user_id, titulo, descricao, data, hora)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, parsed.titulo, parsed.descricao, parsed.data, parsed.hora]
      );
      resposta = `✅ Evento agendado para ${parsed.data}`;
    }
    
    await pool.query(
      `UPDATE messages SET resposta = $1 
       WHERE user_id = $2 AND from_phone = $3 
       AND texto = $4`,
      [resposta, userId, from, message]
    );
    
    res.json({ ok: true, resposta, parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin
api.get("/admin/users", mustAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT u.*, wn.phone,
        (SELECT COUNT(*) FROM events WHERE user_id = u.id) as total_eventos,
        (SELECT COUNT(*) FROM transacoes WHERE user_id = u.id) as total_transacoes
      FROM users u
      LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
      ORDER BY u.criado_em DESC
    `);
    res.json({ users: users.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.post("/admin/users", mustAdmin, async (req, res) => {
  try {
    const { email, nome, plano, status, phone } = req.body;
    const result = await pool.query(
      `INSERT INTO users (email, nome, plano, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET nome = $2, plano = $3, status = $4
       RETURNING *`,
      [email.toLowerCase(), nome, plano || 'FREE', status || 'active']
    );
    
    const user = result.rows[0];
    
    if (phone) {
      await pool.query(
        `INSERT INTO whatsapp_numbers (user_id, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET user_id = $1`,
        [user.id, phone]
      );
    }
    
    res.json({ ok: true, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

api.delete("/admin/users/:id", mustAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Montar API
app.use("/api", api);

// Rota raiz
app.get("/", (req, res) => {
  res.json({
    message: "Atlas Backend API",
    version: "1.0.0",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth/request, /api/auth/verify",
      user: "/api/user/*",
      admin: "/api/admin/*",
      simulator: "/api/simulator/whatsapp"
    },
    admin_key: process.env.ADMIN_KEY ? "configurada" : "admin123 (padrão)"
  });
});

// Iniciar
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Atlas API rodando na porta ${PORT}`);
  console.log(`📞 Endpoint: https://atlas-beckend.onrender.com/api`);
});
