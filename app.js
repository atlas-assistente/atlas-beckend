// ===================== DASHBOARD FUNCTIONS =====================
async function loadDashboard(userId = null) {
  try {
    const url = userId ? 
      `${API_BASE}/admin/dashboard/${userId}` : 
      `${API_BASE}/admin/dashboard`;
    
    const r = await fetch(url, { headers: adminHeaders() });
    const data = await r.json();
    
    if (!r.ok) throw new Error(data?.error || "Falha ao carregar dashboard");
    
    updateDashboardUI(data);
  } catch (e) {
    console.error("Erro dashboard:", e);
  }
}

function updateDashboardUI(data) {
  // Atualizar viewApp (Painel)
  const agendaList = document.getElementById("agendaList") || createAgendaList();
  const financeList = document.getElementById("financeList") || createFinanceList();
  
  // Agenda
  if (data.events && data.events.length > 0) {
    agendaList.innerHTML = data.events.map(event => `
      <div class="atlas-item">
        <div class="atlas-item-main">
          <div class="atlas-item-title">${escapeHtml(event.titulo || 'Evento')}</div>
          <div class="atlas-item-sub">${formatDate(event.data)} ${event.hora || ''}</div>
        </div>
        <div class="atlas-item-badge ${event.status === 'pending' ? 'pending' : 'done'}">
          ${event.status === 'pending' ? 'pendente' : 'concluído'}
        </div>
      </div>
    `).join('');
  } else {
    agendaList.innerHTML = `<div class="atlas-empty">Nenhum evento agendado</div>`;
  }
  
  // Finanças
  if (data.finances && data.finances.length > 0) {
    financeList.innerHTML = data.finances.map(fin => `
      <div class="atlas-item">
        <div class="atlas-item-main">
          <div class="atlas-item-title">${escapeHtml(fin.descricao || 'Transação')}</div>
          <div class="atlas-item-sub">${formatDate(fin.data)} • ${fin.categoria || 'geral'}</div>
        </div>
        <div class="atlas-item-amount ${fin.tipo}">
          ${fin.tipo === 'income' ? '+' : '-'} R$ ${fin.valor.toFixed(2)}
        </div>
      </div>
    `).join('');
  } else {
    financeList.innerHTML = `<div class="atlas-empty">Nenhuma transação registrada</div>`;
  }
  
  // Resumo
  const summaryEl = document.getElementById("summary") || createSummaryElement();
  if (data.summary && data.summary.length > 0) {
    const income = data.summary.find(s => s.tipo === 'income')?.total || 0;
    const expense = data.summary.find(s => s.tipo === 'expense')?.total || 0;
    const balance = income - expense;
    
    summaryEl.innerHTML = `
      <div class="atlas-summary">
        <div class="atlas-summary-item">
          <div class="atlas-summary-label">Receitas</div>
          <div class="atlas-summary-value income">R$ ${income.toFixed(2)}</div>
        </div>
        <div class="atlas-summary-item">
          <div class="atlas-summary-label">Despesas</div>
          <div class="atlas-summary-value expense">R$ ${expense.toFixed(2)}</div>
        </div>
        <div class="atlas-summary-item">
          <div class="atlas-summary-label">Saldo</div>
          <div class="atlas-summary-value ${balance >= 0 ? 'positive' : 'negative'}">
            R$ ${balance.toFixed(2)}
          </div>
        </div>
      </div>
    `;
  }
}

// Funções auxiliares
function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR');
}

function createAgendaList() {
  const container = document.querySelector('#viewApp .atlas-card:nth-child(1)');
  const div = document.createElement('div');
  div.id = 'agendaList';
  div.className = 'atlas-list';
  container.appendChild(div);
  return div;
}

function createFinanceList() {
  const container = document.querySelector('#viewApp .atlas-card:nth-child(2)');
  const div = document.createElement('div');
  div.id = 'financeList';
  div.className = 'atlas-list';
  container.appendChild(div);
  return div;
}

// Atualizar router para carregar dashboard
function route() {
  const hash = (location.hash || "#/login").toLowerCase();
  const adminKey = getAdminKey();
  
  hideAllViews();
  
  if (!adminKey && hash !== "#/login") {
    views.login.classList.add("show");
    return;
  }
  
  if (hash.startsWith("#/admin")) {
    views.admin.classList.add("show");
    nav.admin.classList.add("active");
    loadUsers();
    return;
  }
  
  if (hash.startsWith("#/app")) {
    views.app.classList.add("show");
    nav.app.classList.add("active");
    loadDashboard(); // ← CARREGA DADOS REAIS
    return;
  }
  
  if (hash.startsWith("#/chat")) {
    views.chat.classList.add("show");
    nav.chat.classList.add("active");
    return;
  }
  
  views.login.classList.add("show");
}
