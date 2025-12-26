export function parseMessage(text) {
  const t = text.toLowerCase().trim();

  // Valor
  const valorMatch = t.match(/(\d+[.,]?\d*)/);
  const valor = valorMatch ? parseFloat(valorMatch[1].replace(",", ".")) : null;

  // Data
  const dataMatch = t.match(/dia\s?(\d{1,2})/);
  let data = null;
  if (dataMatch) {
    const d = parseInt(dataMatch[1]);
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    data = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // Hora
  const horaMatch = t.match(/(\d{1,2})h/);
  const hora = horaMatch ? `${horaMatch[1].padStart(2, "0")}:00` : null;

  // Classificação
  if (t.includes("pagar") || t.includes("pagamento")) {
    return {
      tipo: "expense",
      descricao: text,
      valor,
      data,
      vencimento: data
    };
  }

  if (t.includes("recebi") || t.includes("ganhei") || t.includes("salário")) {
    return {
      tipo: "income",
      descricao: text,
      valor,
      data
    };
  }

  if (t.includes("dia") || t.includes("reunião") || t.includes("médico")) {
    return {
      tipo: "event",
      titulo: text,
      data,
      hora
    };
  }

  return {
    tipo: "unknown",
    raw: text
  };
}
