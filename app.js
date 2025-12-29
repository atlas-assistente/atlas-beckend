const API_BASE = "https://atlas-beckend.onrender.com/api";

// ELEMENTOS
const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const btnRequestCode = document.getElementById('btnRequestCode');
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const loginEmail = document.getElementById('loginEmail');
const loginCode = document.getElementById('loginCode');
const codeSection = document.getElementById('codeSection');
const loginMessage = document.getElementById('loginMessage');
const apiStatus = document.getElementById('apiStatus');

// ESTADO
let currentUser = null;
let currentToken = null;
let chartInstance = null;

// INICIALIZAÇÃO
async function init() {
  checkApiStatus();
  loadFromStorage();
  setupEventListeners();
  setupNavigation();
  
  if (currentToken) {
    await validateToken();
  }
}

// API STATUS
async function checkApiStatus() {
  try {
    const response = await fetch(`${API_BASE}/health`);
    const data = await response.json();
    apiStatus.textContent = 'Online';
    apiStatus.style.color = '#12B76A';
  } catch (error) {
    apiStatus.textContent = 'Offline';
    apiStatus.style.color = '#F04438';
  }
}

// STORAGE
function loadFromStorage() {
  currentToken = localStorage.getItem('atlas_token');
  const userData = localStorage.getItem('atlas_user');
  if (userData) {
    currentUser = JSON.parse(userData);
  }
}

function saveToStorage() {
  if (currentToken) {
    localStorage.setItem('atlas_token', currentToken);
  }
  if (currentUser) {
    localStorage.setItem('atlas_user', JSON.stringify(currentUser));
  }
}

function clearStorage() {
  localStorage.removeItem('atlas_token');
  localStorage.removeItem('atlas_user');
  currentToken = null;
  currentUser = null;
}

// VALIDAÇÃO DE TOKEN
async function validateToken() {
  try {
    const response = await fetch(`${API_BASE}/user/profile`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      currentUser = data.user;
      showDashboard();
      loadDashboardData();
    } else {
      clearStorage();
      showLogin();
    }
  } catch (error) {
    clearStorage();
    showLogin();
  }
}

// TELAS
function showLogin() {
  loginScreen.classList.add('active');
  dashboardScreen.classList.remove('active');
  loginEmail.value = '';
  loginCode.value = '';
  codeSection.classList.add('hidden');
  loginMessage.textContent = '';
}

function showDashboard() {
  loginScreen.classList.remove('active');
  dashboardScreen.classList.add('active');
  updateUserInfo();
}

// LOGIN
async function requestCode() {
  const email = loginEmail.value.trim();
  if (!email) {
    showMessage('Por favor, digite seu e-mail', 'error');
    return;
  }
  
  btnRequestCode.disabled = true;
  btnRequestCode.textContent = 'Enviando...';
  
  try {
    const response = await fetch(`${API_BASE}/auth/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      showMessage(`Código enviado para ${email} (Demo: ${data.code})`, 'success');
      codeSection.classList.remove('hidden');
      loginCode.focus();
    } else {
      showMessage(data.error || 'Erro ao enviar código', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  } finally {
    btnRequestCode.disabled = false;
    btnRequestCode.textContent = 'Enviar código';
  }
}

async function verifyCode() {
  const email = loginEmail.value.trim();
  const code = loginCode.value.trim();
  
  if (!email || !code) {
    showMessage('Preencha todos os campos', 'error');
    return;
  }
  
  btnLogin.disabled = true;
  btnLogin.textContent = 'Verificando...';
  
  try {
    const response = await fetch(`${API_BASE}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentToken = data.token;
      currentUser = { id: data.userId, email };
      saveToStorage();
      showDashboard();
      loadDashboardData();
    } else {
      showMessage(data.error || 'Código inválido', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Entrar';
  }
}

function logout() {
  clearStorage();
  showLogin();
}

// NAVEGAÇÃO
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Ativar item de navegação
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Mostrar view correspondente
      const viewName = item.getAttribute('data-view');
      views.forEach(view => {
        view.classList.remove('active');
        if (view.id === `view${capitalize(viewName)}`) {
          view.classList.add('active');
          
          // Carregar dados específicos da view
          if (viewName === 'dashboard') loadDashboardData();
          if (viewName === 'agenda') loadAgendaData();
          if (viewName === 'financas') loadFinancasData();
          if (viewName === 'whatsapp') loadWhatsappData();
        }
      });
    });
  });
}

// DASHBOARD
async function loadDashboardData() {
  if (!currentToken) return;
  
  try {
    const response = await fetch(`${API_BASE}/user/dashboard`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      updateDashboard(data);
      updateCalendar(data.calendario);
      updateEventsList(data.eventos);
      updateTransactionsList(data.transacoes);
      updateFinanceChart(data.transacoes);
      updateStats(data);
    }
  } catch (error) {
    console.error('Erro ao carregar dashboard:', error);
  }
}

function updateDashboard(data) {
  // Atualizar estatísticas
  document.getElementById('totalEvents').textContent = data.eventos?.length || 0;
  document.getElementById('statEventsToday').textContent = data.eventos?.filter(e => 
    e.data === new Date().toISOString().split('T')[0]
  ).length || 0;
  
  // Calcular totais financeiros
  const income = data.transacoes?.filter(t => t.tipo === 'income')
    .reduce((sum, t) => sum + parseFloat(t.valor), 0) || 0;
  const expenses = data.transacoes?.filter(t => t.tipo === 'expense')
    .reduce((sum, t) => sum + parseFloat(t.valor), 0) || 0;
  const balance = income - expenses;
  
  document.getElementById('totalIncome').textContent = `R$ ${income.toFixed(2)}`;
  document.getElementById('totalExpenses').textContent = `R$ ${expenses.toFixed(2)}`;
  document.getElementById('totalMessages').textContent = data.transacoes?.length || 0;
  document.getElementById('statBalance').textContent = `R$ ${balance.toFixed(2)}`;
}

function updateCalendar(calendario) {
  const calendarEl = document.getElementById('calendar');
  if (!calendarEl) return;
  
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const firstDayIndex = firstDay.getDay();
  
  // Nomes dos dias
  const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  
  let calendarHTML = '';
  
  // Cabeçalho dos dias
  dayNames.forEach(day => {
    calendarHTML += `<div class="calendar-day header">${day}</div>`;
  });
  
  // Dias em branco no início
  for (let i = 0; i < firstDayIndex; i++) {
    calendarHTML += `<div class="calendar-day empty"></div>`;
  }
  
  // Dias do mês
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${(month + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    const hasEvents = calendario?.some(item => item.data === dateStr);
    const isToday = day === today.getDate() && month === today.getMonth();
    
    let dayClass = 'calendar-day';
    if (isToday) dayClass += ' active';
    if (hasEvents) dayClass += ' has-events';
    
    calendarHTML += `<div class="${dayClass}" data-date="${dateStr}">${day}</div>`;
  }
  
  calendarEl.innerHTML = calendarHTML;
  
  // Atualizar mês atual
  const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                     'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  document.getElementById('currentMonth').textContent = `${monthNames[month]} ${year}`;
}

function updateEventsList(eventos) {
  const eventsEl = document.getElementById('upcomingEvents');
  if (!eventsEl) return;
  
  if (!eventos || eventos.length === 0) {
    eventsEl.innerHTML = '<div class="empty-state">Nenhum evento agendado</div>';
    return;
  }
  
  // Ordenar por data
  eventos.sort((a, b) => new Date(a.data) - new Date(b.data));
  
  const eventsHTML = eventos.slice(0, 5).map(event => `
    <div class="event-item">
      <div class="event-title">${escapeHtml(event.titulo)}</div>
      <div class="event-date">
        ${formatDate(event.data)} ${event.hora ? `• ${event.hora}` : ''}
      </div>
    </div>
  `).join('');
  
  eventsEl.innerHTML = eventsHTML;
}

function updateTransactionsList(transacoes) {
  const transactionsEl = document.getElementById('recentTransactions');
  if (!transactionsEl) return;
  
  if (!transacoes || transacoes.length === 0) {
    transactionsEl.innerHTML = '<div class="empty-state">Nenhuma transação</div>';
    return;
  }
  
  // Ordenar por data (mais recente primeiro)
  transacoes.sort((a, b) => new Date(b.data) - new Date(a.data));
  
  const transactionsHTML = transacoes.slice(0, 5).map(trans => `
    <div class="transaction-item">
      <div class="transaction-desc">${escapeHtml(trans.descricao)}</div>
      <div class="transaction-amount ${trans.tipo}">
        ${trans.tipo === 'income' ? '+' : '-'} R$ ${parseFloat(trans.valor).toFixed(2)}
        • ${formatDate(trans.data)}
      </div>
    </div>
  `).join('');
  
  transactionsEl.innerHTML = transactionsHTML;
}

function updateFinanceChart(transacoes) {
  const canvas = document.getElementById('chartCanvas');
  if (!canvas || !transacoes || transacoes.length === 0) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
    return;
  }
  
  // Agrupar por mês
  const monthlyData = {};
  transacoes.forEach(trans => {
    const date = new Date(trans.data);
    const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { income: 0, expense: 0 };
    }
    
    if (trans.tipo === 'income') {
      monthlyData[monthKey].income += parseFloat(trans.valor);
    } else {
      monthlyData[monthKey].expense += parseFloat(trans.valor);
    }
  });
  
  const months = Object.keys(monthlyData).sort();
  const incomeData = months.map(month => monthlyData[month].income);
  const expenseData = months.map(month => monthlyData[month].expense);
  
  // Formatar nomes dos meses
  const monthLabels = months.map(month => {
    const [year, m] = month.split('-');
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 
                       'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${monthNames[parseInt(m) - 1]}/${year.slice(2)}`;
  });
  
  if (chartInstance) {
    chartInstance.destroy();
  }
  
  const ctx = canvas.getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: monthLabels,
      datasets: [
        {
          label: 'Receitas',
          data: incomeData,
          backgroundColor: '#10B981',
          borderRadius: 6
        },
        {
          label: 'Despesas',
          data: expenseData,
          backgroundColor: '#EF4444',
          borderRadius: 6
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'top',
        },
        tooltip: {
          callbacks: {
            label: (context) => {
              return `${context.dataset.label}: R$ ${context.raw.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => `R$ ${value}`
          }
        }
      }
    }
  });
}

function updateStats(data) {
  const income = data.transacoes?.filter(t => t.tipo === 'income')
    .reduce((sum, t) => sum + parseFloat(t.valor), 0) || 0;
  const expenses = data.transacoes?.filter(t => t.tipo === 'expense')
    .reduce((sum, t) => sum + parseFloat(t.valor), 0) || 0;
  const balance = income - expenses;
  
  document.getElementById('totalReceitas').textContent = `R$ ${income.toFixed(2)}`;
  document.getElementById('totalDespesas').textContent = `R$ ${expenses.toFixed(2)}`;
  document.getElementById('saldoTotal').textContent = `R$ ${balance.toFixed(2)}`;
}

// AGENDA
async function loadAgendaData() {
  if (!currentToken) return;
  
  try {
    const response = await fetch(`${API_BASE}/user/dashboard`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      renderAgendaList(data.eventos);
    }
  } catch (error) {
    console.error('Erro ao carregar agenda:', error);
  }
}

function renderAgendaList(eventos) {
  const agendaEl = document.getElementById('agendaList');
  if (!agendaEl) return;
  
  if (!eventos || eventos.length === 0) {
    agendaEl.innerHTML = '<div class="empty-state">Nenhum evento agendado</div>';
    return;
  }
  
  // Ordenar por data
  eventos.sort((a, b) => new Date(a.data) - new Date(b.data));
  
  const agendaHTML = eventos.map(event => `
    <div class="agenda-item">
      <div class="agenda-item-date">
        <div class="agenda-day">${new Date(event.data).getDate()}</div>
        <div class="agenda-month">${getMonthAbbr(new Date(event.data).getMonth())}</div>
      </div>
      <div class="agenda-item-content">
        <div class="agenda-item-title">${escapeHtml(event.titulo)}</div>
        <div class="agenda-item-desc">${escapeHtml(event.descricao || '')}</div>
        <div class="agenda-item-time">${event.hora || 'Dia todo'}</div>
      </div>
      <div class="agenda-item-actions">
        <button class="btn-icon" onclick="deleteEvent('${event.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
  
  agendaEl.innerHTML = agendaHTML;
}

// FINANÇAS
async function loadFinancasData() {
  if (!currentToken) return;
  
  try {
    const response = await fetch(`${API_BASE}/user/dashboard`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      renderTransactionsTable(data.transacoes);
      updateStats(data);
    }
  } catch (error) {
    console.error('Erro ao carregar finanças:', error);
  }
}

function renderTransactionsTable(transacoes) {
  const tableEl = document.getElementById('transactionsTable');
  if (!tableEl) return;
  
  if (!transacoes || transacoes.length === 0) {
    tableEl.innerHTML = '<div class="empty-state">Nenhuma transação registrada</div>';
    return;
  }
  
  // Ordenar por data (mais recente primeiro)
  transacoes.sort((a, b) => new Date(b.data) - new Date(a.data));
  
  const tableHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Data</th>
          <th>Descrição</th>
          <th>Categoria</th>
          <th>Valor</th>
          <th>Ações</th>
        </tr>
      </thead>
      <tbody>
        ${transacoes.map(trans => `
          <tr>
            <td>${formatDate(trans.data)}</td>
            <td>${escapeHtml(trans.descricao)}</td>
            <td><span class="category-badge">${trans.categoria}</span></td>
            <td class="${trans.tipo}">
              ${trans.tipo === 'income' ? '+' : '-'} R$ ${parseFloat(trans.valor).toFixed(2)}
            </td>
            <td>
              <button class="btn-icon" onclick="deleteTransaction('${trans.id}')">🗑️</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  
  tableEl.innerHTML = tableHTML;
}

// WHATSAPP
function loadWhatsappData() {
  // Inicializar chat vazio
  const chatEl = document.getElementById('chatMessages');
  if (chatEl.children.length === 1) { // Só tem a mensagem inicial
    chatEl.innerHTML = `
      <div class="message bot">
        <div class="message-content">
          Olá! Sou o Atlas, seu assistente pessoal.
          <div class="message-examples">
            <strong>Exemplos:</strong><br>
            • "pagar aluguel 1500 dia 05"<br>
            • "médico amanhã 14h"<br>
            • "recebi 3200 salário"
          </div>
        </div>
        <div class="message-time">Agora</div>
      </div>
    `;
  }
}

async function sendWhatsAppMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message || !currentToken) return;
  
  // Adicionar mensagem do usuário
  addMessageToChat(message, 'user');
  input.value = '';
  
  try {
    const response = await fetch(`${API_BASE}/simulator/whatsapp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ADMIN-KEY': 'admin123' // Chave padrão para demo
      },
      body: JSON.stringify({
        from: '5511999999999', // Número padrão para demo
        message
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      addMessageToChat(data.resposta, 'bot');
      
      // Atualizar dashboard se necessário
      if (data.parsed.tipo !== 'unknown') {
        setTimeout(() => loadDashboardData(), 1000);
      }
    } else {
      addMessageToChat(`Erro: ${data.error}`, 'bot');
    }
  } catch (error) {
    addMessageToChat('Erro de conexão com o servidor', 'bot');
  }
}

function addMessageToChat(text, sender) {
  const chatEl = document.getElementById('chatMessages');
  const messageEl = document.createElement('div');
  messageEl.className = `message ${sender}`;
  messageEl.innerHTML = `
    <div class="message-content">${escapeHtml(text)}</div>
    <div class="message-time">${formatTime(new Date())}</div>
  `;
  chatEl.appendChild(messageEl);
  chatEl.scrollTop = chatEl.scrollHeight;
}

// EVENTOS (MODAIS)
function setupEventListeners() {
  // Login
  btnRequestCode.addEventListener('click', requestCode);
  btnLogin.addEventListener('click', verifyCode);
  btnLogout.addEventListener('click', logout);
  
  // Enter no código
  loginCode.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verifyCode();
  });
  
  // WhatsApp
  const chatInput = document.getElementById('chatInput');
  const btnSendMessage = document.getElementById('btnSendMessage');
  
  if (chatInput && btnSendMessage) {
    btnSendMessage.addEventListener('click', sendWhatsAppMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendWhatsAppMessage();
    });
  }
  
  // Modais
  setupModals();
  
  // Botões do dashboard
  setupDashboardButtons();
}

function setupModals() {
  // Novo Evento
  const btnAddEvent = document.getElementById('btnAddEvent');
  const btnNewEvent = document.getElementById('btnNewEvent');
  const modalEvent = document.getElementById('modalEvent');
  const btnSaveEvent = document.getElementById('btnSaveEvent');
  
  [btnAddEvent, btnNewEvent].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      openModal('modalEvent');
      document.getElementById('eventDate').value = new Date().toISOString().split('T')[0];
    });
  });
  
  if (btnSaveEvent) {
    btnSaveEvent.addEventListener('click', saveEvent);
  }
  
  // Nova Transação
  const btnAddTransaction = document.getElementById('btnAddTransaction');
  const btnNewTransaction = document.getElementById('btnNewTransaction');
  const modalTransaction = document.getElementById('modalTransaction');
  const btnSaveTransaction = document.getElementById('btnSaveTransaction');
  
  [btnAddTransaction, btnNewTransaction].forEach(btn => {
    if (btn) btn.addEventListener('click', () => {
      openModal('modalTransaction');
      document.getElementById('transactionDate').value = new Date().toISOString().split('T')[0];
    });
  });
  
  if (btnSaveTransaction) {
    btnSaveTransaction.addEventListener('click', saveTransaction);
  }
  
  // Toggle tipo de transação
  const typeButtons = document.querySelectorAll('.type-btn');
  typeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      typeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // Fechar modais
  const closeButtons = document.querySelectorAll('.modal-close');
  closeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllModals();
    });
  });
  
  // Fechar modal clicando fora
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAllModals();
      }
    });
  });
}

function setupDashboardButtons() {
  // Navegação do calendário
  const btnPrevMonth = document.getElementById('btnPrevMonth');
  const btnNextMonth = document.getElementById('btnNextMonth');
  
  if (btnPrevMonth) btnPrevMonth.addEventListener('click', () => {
    // Implementar navegação de mês
    console.log('Previous month');
  });
  
  if (btnNextMonth) btnNextMonth.addEventListener('click', () => {
    // Implementar navegação de mês
    console.log('Next month');
  });
  
  // Filtros
  const filterMonth = document.getElementById('filterMonth');
  const filterCategory = document.getElementById('filterCategory');
  const periodSelect = document.getElementById('periodSelect');
  
  if (filterMonth) filterMonth.addEventListener('change', loadFinancasData);
  if (filterCategory) filterCategory.addEventListener('change', loadFinancasData);
  if (periodSelect) periodSelect.addEventListener('change', loadDashboardData);
  
  // Exportar
  const btnExport = document.getElementById('btnExport');
  if (btnExport) btnExport.addEventListener('click', exportData);
}

// FUNÇÕES CRUD
async function saveEvent() {
  const title = document.getElementById('eventTitle').value.trim();
  const description = document.getElementById('eventDescription').value.trim();
  const date = document.getElementById('eventDate').value;
  const time = document.getElementById('eventTime').value || null;
  
  if (!title || !date) {
    showMessage('Preencha título e data', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/event`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ titulo: title, descricao: description, data: date, hora: time })
    });
    
    if (response.ok) {
      closeAllModals();
      showMessage('Evento salvo com sucesso!', 'success');
      loadDashboardData();
      loadAgendaData();
    } else {
      const data = await response.json();
      showMessage(data.error || 'Erro ao salvar evento', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  }
}

async function saveTransaction() {
  const type = document.querySelector('.type-btn.active').getAttribute('data-type');
  const description = document.getElementById('transactionDescription').value.trim();
  const value = parseFloat(document.getElementById('transactionValue').value);
  const category = document.getElementById('transactionCategory').value;
  const date = document.getElementById('transactionDate').value;
  
  if (!description || isNaN(value) || value <= 0 || !date) {
    showMessage('Preencha todos os campos corretamente', 'error');
    return;
  }
  
  try {
    const response = await fetch(`${API_BASE}/user/transacao`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${currentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tipo: type,
        descricao: description,
        valor: value,
        categoria: category,
        data: date
      })
    });
    
    if (response.ok) {
      closeAllModals();
      showMessage('Transação salva com sucesso!', 'success');
      loadDashboardData();
      loadFinancasData();
    } else {
      const data = await response.json();
      showMessage(data.error || 'Erro ao salvar transação', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  }
}

async function deleteEvent(eventId) {
  if (!confirm('Excluir este evento?')) return;
  
  // Implementar endpoint de exclusão
  showMessage('Funcionalidade em desenvolvimento', 'info');
}

async function deleteTransaction(transactionId) {
  if (!confirm('Excluir esta transação?')) return;
  
  // Implementar endpoint de exclusão
  showMessage('Funcionalidade em desenvolvimento', 'info');
}

// UTILIDADES
function openModal(modalId) {
  closeAllModals();
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('hidden');
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.add('hidden');
  });
}

function showMessage(text, type) {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${type}`;
  messageEl.textContent = text;
  messageEl.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 16px 24px;
    border-radius: 8px;
    color: white;
    z-index: 10000;
    animation: slideIn 0.3s ease;
  `;
  
  if (type === 'success') messageEl.style.background = '#10B981';
  if (type === 'error') messageEl.style.background = '#EF4444';
  if (type === 'info') messageEl.style.background = '#3B82F6';
  
  document.body.appendChild(messageEl);
  
  setTimeout(() => {
    messageEl.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => messageEl.remove(), 300);
  }, 3000);
}

function updateUserInfo() {
  if (currentUser) {
    document.getElementById('userName').textContent = currentUser.email;
    document.getElementById('userPlan').textContent = currentUser.plano || 'FREE';
  }
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR');
}

function formatTime(date) {
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function getMonthAbbr(month) {
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 
                  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return months[month];
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function exportData() {
  try {
    const response = await fetch(`${API_BASE}/user/dashboard`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    
    if (response.ok) {
      const data = await response.json();
      
      // Criar CSV simples
      let csv = 'Data,Descrição,Valor,Tipo\n';
      
      data.transacoes?.forEach(trans => {
        csv += `${trans.data},"${trans.descricao}",${trans.valor},${trans.tipo}\n`;
      });
      
      // Baixar arquivo
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `atlas-export-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      
      showMessage('Exportação concluída!', 'success');
    }
  } catch (error) {
    showMessage('Erro ao exportar dados', 'error');
  }
}

// INICIAR APLICAÇÃO
document.addEventListener('DOMContentLoaded', init);
