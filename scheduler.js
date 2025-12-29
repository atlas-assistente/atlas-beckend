import cron from "node-cron";
import { pool } from "./db.js";

export function startScheduler() {
  console.log("⏰ Scheduler iniciado");
  
  // A cada minuto: verificar eventos para notificar
  cron.schedule("* * * * *", async () => {
    try {
      const now = new Date();
      const today = now.toISOString().split('T')[0];
      const time = now.toTimeString().split(':').slice(0, 2).join(':');
      
      // Eventos para hoje, hora atual ou passada, não notificados
      const result = await pool.query(
        `SELECT e.*, u.email, wn.phone 
         FROM events e
         JOIN users u ON u.id = e.user_id
         LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
         WHERE e.data = $1 
         AND (e.hora <= $2 OR e.hora IS NULL)
         AND e.notificado = false
         AND e.status = 'pending'`,
        [today, time]
      );
      
      for (const event of result.rows) {
        console.log(`🔔 Lembrete: ${event.titulo} para ${event.phone || event.email}`);
        
        // Aqui enviaria WhatsApp/email real
        // Por enquanto só marca como notificado
        await pool.query(
          'UPDATE events SET notificado = true WHERE id = $1',
          [event.id]
        );
        
        // Salva no histórico de mensagens
        if (event.phone) {
          await pool.query(
            `INSERT INTO messages (channel, from_phone, text, reply)
             VALUES ('reminder', $1, $2, $3)`,
            [event.phone, 
             `Lembrete automático: ${event.titulo}`,
             `⏰ ${event.titulo}\n📅 ${event.data} ${event.hora ? `às ${event.hora}` : ''}`
            ]
          );
        }
      }
    } catch (err) {
      console.error("Erro no scheduler:", err);
    }
  });
  
  // A cada dia à meia-noite: verificar contas vencendo
  cron.schedule("0 0 * * *", async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      
      // Despesas que vencem amanhã e não estão pagas
      const result = await pool.query(
        `SELECT f.*, u.email, wn.phone 
         FROM financeiro f
         JOIN users u ON u.id = f.user_id
         LEFT JOIN whatsapp_numbers wn ON wn.user_id = u.id
         WHERE f.tipo = 'expense' 
         AND f.pago = false
         AND f.data = $1`,
        [tomorrowStr]
      );
      
      for (const expense of result.rows) {
        console.log(`💰 Conta vencendo: ${expense.descricao} R$${expense.valor}`);
        
        if (expense.phone) {
          await pool.query(
            `INSERT INTO messages (channel, from_phone, text, reply)
             VALUES ('reminder', $1, $2, $3)`,
            [expense.phone,
             `Lembrete de conta: ${expense.descricao}`,
             `💰 ${expense.descricao} vence amanhã!\nValor: R$${expense.valor}\nData: ${expense.data}`
            ]
          );
        }
      }
    } catch (err) {
      console.error("Erro no scheduler diário:", err);
    }
  });
}
