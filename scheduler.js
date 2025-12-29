import cron from "node-cron";
import { pool } from "./db.js";

export function startScheduler() {
  cron.schedule("* * * * *", async () => {
    const now = new Date();
    const res = await pool.query(
      "SELECT * FROM events WHERE data = CURRENT_DATE AND hora <= CURRENT_TIME AND status='pendente'"
    );

    for (const event of res.rows) {
      console.log("⏰ Enviar lembrete:", event.titulo);
      await pool.query("UPDATE events SET status='notificado' WHERE id=$1", [event.id]);
    }
  });
}
