export function parseMessage(text) {
  const msg = text.toLowerCase();

  if (msg.includes("gasto") || msg.includes("paguei")) {
    const value = msg.match(/(\d+[.,]?\d*)/);
    return { tipo: "expense", valor: value ? value[1] : null };
  }

  if (msg.includes("recebi") || msg.includes("entrou")) {
    const value = msg.match(/(\d+[.,]?\d*)/);
    return { tipo: "income", valor: value ? value[1] : null };
  }

  if (msg.includes("me deve")) {
    const value = msg.match(/(\d+[.,]?\d*)/);
    const person = msg.split("me deve")[0].trim();
    return { tipo: "credit", pessoa: person, valor: value ? value[1] : null };
  }

  if (msg.includes("pagar")) {
    const value = msg.match(/(\d+[.,]?\d*)/);
    return { tipo: "debt", valor: value ? value[1] : null };
  }

  return { tipo: "unknown" };
}
