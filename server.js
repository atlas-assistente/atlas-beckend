import express from "express";
import cors from "cors";
import { Pool } from "pg";
import crypto from "crypto";
import cron from "node-cron";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";

// Configurar paths
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Criar pasta public se não existir
const publicDir = join(__dirname, "public");
if (!existsSync(publicDir)) {
  mkdirSync(publicDir, { recursive: true });
  
  // Criar index.html básico
  const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <title>Atlas Backend</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
    .container { background: white; padding: 40px; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); }
    h1 { color: #246BFD; margin-top: 0; }
    .endpoint { background: #f8fafc; padding: 15px; border-radius: 10px; margin: 15px 0; font-family: monospace; }
    .method { display: inline-block; background: #246BFD; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; margin-right: 10px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚀 Atlas Backend API</h1>
    <p>Sistema rodando corretamente. Frontend disponível em <a href="/client">/client</a></p>
    
    <h2>📡 Endpoints da API:</h2>
    
    <div class="endpoint">
      <span class="method">GET</span> <strong>/api/health</strong> - Health check
    </div>
    
    <div class="endpoint">
      <span class="method">POST</span> <strong>/api/auth/request</strong> - Solicitar código de login
    </div>
    
    <div class="endpoint">
      <span class="method">POST</span> <strong>/api/auth/verify</strong> - Verificar código e obter token
    </div>
    
    <div class="endpoint">
      <span class="method">GET</span> <strong>/api/user/dashboard</strong> - Dashboard do usuário (Bearer token)
    </div>
    
    <div class="endpoint">
      <span class="method">POST</span> <strong>/api/simulator/whatsapp</strong> - Simulador (X-ADMIN-KEY: admin123)
    </div>
    
    <div class="endpoint">
      <span class="method">GET</span> <strong>/api/admin/users</strong> - Listar usuários (X-ADMIN-KEY: admin123)
    </div>
    
    <h2>🔑 Credenciais para teste:</h2>
    <ul>
      <li><strong>Admin Key:</strong> admin123</li>
      <li><strong>Email:</strong> qualquer email válido</li>
      <li><strong>Código:</strong> será mostrado no console/log</li>
    </ul>
    
    <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 14px;">
      Sistema Atlas • Backend + PostgreSQL • Render + GitHub Pages
    </div>
  </div>
</body>
</html>`;
  
  writeFileSync(join(publicDir, "index.html"), indexHtml);
  console.log("✅ Pasta public criada com index.html");
}

// Configurar PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Iniciar Express
const app = express();
app.use(cors());
app.use(express.json());

// ====================== MIGRAÇÃO DO BANCO ======================
async function autoMigrate() {
  try {
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
    console.log("✅ Banco de dados migrado com sucesso");
  } catch (error) {
    console.error("❌ Erro na migração do banco:", error.message);
  }
}

// Executar migração
await autoMigrate();

// ====================== PARSER DE MENSAGENS ======================
function parseMessage(texto) {
  if (!texto || typeof texto !== 'string') return { tipo: "unknown", texto: "" };
  
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
  
  if (t.includes("recebi") || t.includes("ganhei") || t.includes("salário") || t.includes("salario")) {
    return {
      tipo: "income",
      descricao: texto,
      valor,
      data: data || new Date().toISOString().split('T')[0],
      categoria: "renda"
    };
  }
  
  if (t.includes("dia") || t.includes("médico") || t.includes("medico") || t.includes("reunião") || t.includes("reuniao")) {
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

// ====================== AGENDADOR ======================
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
      console.error("Erro no scheduler:", err.message);
    }
  });
  console.log("⏰ Agendador iniciado");
}

startScheduler();

// ====================== MIDDLEWARES ======================
function mustAdmin(req, res, next) {
  const key = req.headers["x-admin-key"];
  const expected = process.env.ADMIN_KEY || "admin123";
  if (key === expected) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized. Use X-ADMIN-KEY: admin123" });
  }
}

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

// ====================== API ROTAS ======================
const api = express.Router();

// HEALTH CHECK
api.get("/health", (req, res) => {
  res.json({ 
    ok: true, 
    timestamp: new Date().toISOString(),
    service: "Atlas Backend API",
    version: "1.0.0"
  });
});

// AUTH - SOLICITAR CÓDIGO
api.post("/auth/request", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email é obrigatório" });
    
    // Buscar ou criar usuário
    let user = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    
    let userId;
    if (user.rows.length === 0) {
      const novo = await pool.query(
        `INSERT INTO users (email, nome) VALUES ($1, $2) RETURNING id`,
        [email.toLowerCase().trim(), email.split('@')[0]]
      );
      userId = novo.rows[0].id;
    } else {
      userId = user.rows[0].id;
    }
    
    // Gerar código
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60000); // 15 minutos
    
    await pool.query(
      `INSERT INTO login_codes (user_id, code, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, code, expires]
    );
    
    console.log(`📧 Código para ${email}: ${code} (válido até ${expres.toLocaleTimeString()})`);
    
    res.json({ 
      ok: true, 
      message: "Código enviado (veja o console do servidor)",
      code: code, // Para desenvolvimento
      expires: expires.toISOString()
    });
  } catch (err) {
    console.error("Erro em /auth/request:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// AUTH - VERIFICAR CÓDIGO
api.post("/auth/verify", async (req, res) => {
  try {
    const { email, code } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ error: "Email e código são obrigatórios" });
    }
    
    const result = await pool.query(
      `SELECT lc.*, u.id as user_id, u.email, u.nome 
       FROM login_codes lc
       JOIN users u ON u.id = lc.user_id
       WHERE u.email = $1 AND lc.code = $2 
       AND lc.expires_at > NOW() AND lc.used = false
       LIMIT 1`,
      [email.toLowerCase().trim(), code.trim()]
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
    const token = crypto.randomBytes(32).toString("hex");
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60000); // 7 dias
    
    await pool.query(
      `INSERT INTO sessions (user_id, token, expires_at)
       VALUES ($1, $2, $3)`,
      [result.rows[0].user_id, token, expires]
    );
    
    res.json({ 
      ok: true, 
      token, 
      user: {
        id: result.rows[0].user_id,
        email: result.rows[0].email,
        nome: result.rows[0].nome
      },
      expires: expires.toISOString()
    });
  } catch (err) {
    console.error("Erro em /auth/verify:", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// USER - PERFIL
api.get("/user/profile", authenticate, async (req, res) => {
  try {
    res.json({
      ok: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        nome: req.user.nome,
        plano: req.user.plano || 'FREE',
        status: req.user.status || 'active'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// USER - DASHBOARD
api.get("/user/dashboard", authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Eventos futuros
    const eventos = await pool.query(
      `SELECT * FROM events 
       WHERE user_id = $1 AND data >= CURRENT_DATE
       ORDER BY data, hora
       LIMIT 20`,
      [userId]
    );
    
    // Transações recentes
    const transacoes = await pool.query(
      `SELECT * FROM transacoes 
       WHERE user_id = $1
       ORDER BY data DESC, criado_em DESC
       LIMIT 20`,
      [userId]
    );
    
    // Resumo financeiro
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
    
    // Calendário do mês
    const hoje = new Date();
    const primeiroDia = new Date(hoje.getFullYear(), hoje.getMonth(), 1)
      .toISOString().split('T')[0];
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)
      .toISOString().split('T')[0];
    
    const calendario = await pool.query(
      `SELECT data, COUNT(*) as eventos,
        ARRAY_AGG(LEFT(titulo, 20)) as titulos
       FROM events
       WHERE user_id = $1 
       AND data BETWEEN $2 AND $3
       GROUP BY data
       ORDER BY data`,
      [userId, primeiroDia, ultimoDia]
    );
    
    // Mensagens recentes
    const mensagens = await pool.query(
      `SELECT * FROM messages 
       WHERE user_id = $1
       ORDER BY criado_em DESC
       LIMIT 10`,
      [userId]
    );
    
    res.json({
      ok: true,
      dashboard: {
        eventos: eventos.rows,
        transacoes: transacoes.rows,
        resumo: resumo.rows,
        calendario: calendario.rows,
        mensagens: mensagens.rows,
        total_eventos: eventos.rows.length,
        total_transacoes: transacoes.rows.length
      }
    });
  } catch (err) {
    console.error("Erro em /user/dashboard:", err);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

// USER - CRIAR EVENTO
api.post("/user/event", authenticate, async (req, res) => {
  try {
    const { titulo, descricao, data, hora } = req.body;
    
    if (!titulo || !data) {
      return res.status(400).json({ error: "Título e data são obrigatórios" });
    }
    
    const result = await pool.query(
      `INSERT INTO events (user_id, titulo, descricao, data, hora)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.id, titulo, descricao || '', data, hora || null]
    );
    
    res.json({ 
      ok: true, 
      message: "Evento criado com sucesso",
      evento: result.rows[0]
    });
  } catch (err) {
    console.error("Erro em /user/event:", err);
    res.status(500).json({ error: "Erro ao criar evento" });
  }
});

// USER - CRIAR TRANSAÇÃO
api.post("/user/transacao", authenticate, async (req, res) => {
  try {
    const { tipo, descricao, valor, categoria, data } = req.body;
    
    if (!tipo || !descricao || !valor || !data) {
      return res.status(400).json({ error: "Todos os campos são obrigatórios" });
    }
    
    if (tipo !== 'income' && tipo !== 'expense') {
      return res.status(400).json({ error: "Tipo deve ser 'income' ou 'expense'" });
    }
    
    const valorNumero = parseFloat(valor);
    if (isNaN(valorNumero) || valorNumero <= 0) {
      return res.status(400).json({ error: "Valor deve ser um número positivo" });
    }
    
    const result = await pool.query(
      `INSERT INTO transacoes (user_id, tipo, descricao, valor, categoria, data)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        req.user.id, 
        tipo, 
        descricao, 
        valorNumero, 
        categoria || 'outros', 
        data
      ]
    );
    
    res.json({ 
      ok: true, 
      message: tipo === 'income' ? "Receita registrada" : "Despesa registrada",
      transacao: result.rows[0]
    });
  } catch (err) {
    console.error("Erro em /user/transacao:", err);
    res.status(500).json({ error: "Erro ao criar transação" });
  }
});

// SIMULADOR WHATSAPP
api.post("/simulator/whatsapp", mustAdmin, async (req, res) => {
  try {
    const { from, message } = req.body;
    
    if (!from || !message) {
      return res.status(400).json({ error: "'from' e 'message' são obrigatórios" });
    }
    
    const parsed = parseMessage(message);
    
    // Buscar ou criar usuário pelo telefone
    let userResult = await pool.query(
      `SELECT u.id FROM users u
       JOIN whatsapp_numbers wn ON wn.user_id = u.id
       WHERE wn.phone = $1`,
      [from]
    );
    
    let userId;
    if (userResult.rows.length === 0) {
      // Criar novo usuário
      const novoUser = await pool.query(
        `INSERT INTO users (email, nome, plano) 
         VALUES ($1, $2, $3) RETURNING id`,
        [`${from}@whatsapp.atlas`, `Usuário ${from}`, 'FREE']
      );
      userId = novoUser.rows[0].id;
      
      await pool.query(
        `INSERT INTO whatsapp_numbers (user_id, phone) VALUES ($1, $2)`,
        [userId, from]
      );
      
      console.log(`👤 Novo usuário criado via WhatsApp: ${from}`);
    } else {
      userId = userResult.rows[0].id;
    }
    
    // Salvar mensagem
    const msgResult = await pool.query(
      `INSERT INTO messages (user_id, from_phone, texto, parsed, canal)
       VALUES ($1, $2, $3, $4, 'simulator')
       RETURNING id, criado_em`,
      [userId, from, message, JSON.stringify(parsed)]
    );
    
    let resposta = "✅ Mensagem recebida!";
    let action = null;
    
    // Processar conforme tipo
    if (parsed.tipo === 'expense' || parsed.tipo === 'income') {
      const transResult = await pool.query(
        `INSERT INTO transacoes (user_id, tipo, descricao, valor, categoria, data)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          userId, 
          parsed.tipo, 
          parsed.descricao || message, 
          parsed.valor || 0, 
          parsed.categoria || 'outros', 
          parsed.data || new Date().toISOString().split('T')[0]
        ]
      );
      
      resposta = parsed.tipo === 'income' 
        ? `✅ Receita de R$${parsed.valor || 0} registrada!` 
        : `✅ Despesa de R$${parsed.valor || 0} registrada!`;
      
      action = {
        tipo: 'transacao',
        id: transResult.rows[0].id,
        valor: parsed.valor
      };
    }
    
    if (parsed.tipo === 'event') {
      const eventResult = await pool.query(
        `INSERT INTO events (user_id, titulo, descricao, data, hora)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          userId, 
          parsed.titulo || parsed.descricao || message,
          parsed.descricao || message,
          parsed.data || new Date().toISOString().split('T')[0],
          parsed.hora
        ]
      );
      
      const dataFormatada = parsed.data ? new Date(parsed.data).toLocaleDateString('pt-BR') : 'hoje';
      resposta = `✅ Evento agendado para ${dataFormatada}${parsed.hora ? ` às ${parsed.hora}` : ''}!`;
      
      action = {
        tipo: 'evento',
        id: eventResult.rows[0].id,
        data: parsed.data
      };
    }
    
    // Atualizar mensagem com resposta
    await pool.query(
      `UPDATE messages SET resposta = $1 WHERE id = $2`,
      [resposta, msgResult.rows[0].id]
    );
    
    res.json({ 
      ok: true, 
      resposta,
      parsed,
      action,
      user_id: userId,
      timestamp: msgResult.rows[0].criado_em
    });
  } catch (err) {
    console.error("Erro em /simulator/whatsapp:", err);
    res.status(500).json({ error: "Erro no processamento da mensagem" });
  }
});

// ADMIN - LISTAR USUÁRIOS
api.get("/admin/users", mustAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT 
        u.*, 
        wn.phone,
        (SELECT COUNT(*) FROM events WHERE user_id = u.id) as total_eventos,
        (SELECT COUNT(*) FROM transacoes WHERE user_id = u.id) as total_transacoes,
        (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as total_mensagens
      FROM users u
      LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
      ORDER BY u.criado_em DESC
      LIMIT 100
    `);
    
    res.json({ 
      ok: true, 
      users: users.rows,
      total: users.rows.length
    });
  } catch (err) {
    console.error("Erro em /admin/users:", err);
    res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

// ADMIN - CRIAR/ATUALIZAR USUÁRIO
api.post("/admin/users", mustAdmin, async (req, res) => {
  try {
    const { email, nome, plano, status, phone } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: "Email é obrigatório" });
    }
    
    const result = await pool.query(
      `INSERT INTO users (email, nome, plano, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE
       SET nome = EXCLUDED.nome, 
           plano = EXCLUDED.plano, 
           status = EXCLUDED.status,
           criado_em = CASE 
             WHEN users.criado_em IS NULL THEN NOW() 
             ELSE users.criado_em 
           END
       RETURNING *`,
      [
        email.toLowerCase().trim(), 
        nome || '', 
        plano || 'FREE', 
        status || 'active'
      ]
    );
    
    const user = result.rows[0];
    
    if (phone) {
      await pool.query(
        `INSERT INTO whatsapp_numbers (user_id, phone)
         VALUES ($1, $2)
         ON CONFLICT (phone) DO UPDATE SET user_id = $1`,
        [user.id, phone.trim()]
      );
    }
    
    res.json({ 
      ok: true, 
      message: "Usuário salvo com sucesso",
      user
    });
  } catch (err) {
    console.error("Erro em /admin/users (POST):", err);
    res.status(500).json({ error: "Erro ao salvar usuário" });
  }
});

// ADMIN - EXCLUIR USUÁRIO
api.delete("/admin/users/:id", mustAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    
    res.json({ 
      ok: true, 
      message: "Usuário excluído com sucesso"
    });
  } catch (err) {
    console.error("Erro em /admin/users (DELETE):", err);
    res.status(500).json({ error: "Erro ao excluir usuário" });
  }
});

// MONTAR API
app.use("/api", api);

// SERVIR ARQUIVOS ESTÁTICOS
app.use(express.static(publicDir));
app.use("/client", express.static(join(__dirname, "client")));

// ROTA RAIZ - REDIRECIONAR PARA PÁGINA INICIAL
app.get("/", (req, res) => {
  res.sendFile(join(publicDir, "index.html"));
});

// ROTA PARA CLIENT (LOGIN SIMPLES)
app.get("/client", (req, res) => {
  res.sendFile(join(__dirname, "client", "index.html"));
});

// ROTA FALLBACK
app.use((req, res) => {
  res.status(404).json({
    error: "Rota não encontrada",
    available_routes: {
      api: "/api",
      client: "/client",
      admin: "Use X-ADMIN-KEY: admin123"
    }
  });
});

// INICIAR SERVIDOR
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 ==============================================`);
  console.log(`   Atlas Backend iniciado na porta ${PORT}`);
  console.log(`   URL: https://atlas-beckend.onrender.com`);
  console.log(`   API: https://atlas-beckend.onrender.com/api`);
  console.log(`   Client: https://atlas-beckend.onrender.com/client`);
  console.log(`   Admin Key: admin123`);
  console.log(`================================================\n`);
  
  console.log(`📊 Endpoints disponíveis:`);
  console.log(`   • GET  /api/health           - Health check`);
  console.log(`   • POST /api/auth/request     - Solicitar código`);
  console.log(`   • POST /api/auth/verify      - Verificar código`);
  console.log(`   • GET  /api/user/dashboard   - Dashboard (token)`);
  console.log(`   • POST /api/simulator/whatsapp - Simulador (admin)`);
  console.log(`   • GET  /api/admin/users      - Admin (admin key)`);
  console.log(`\n🔑 Para teste:`);
  console.log(`   • Email: qualquer@email.com`);
  console.log(`   • Código: ver console do servidor`);
  console.log(`   • Admin Key: admin123`);
});
