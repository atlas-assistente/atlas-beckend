const API_BASE = window.location.origin + '/api';

// Estado
let currentToken = null;
let currentUser = null;
let currentView = 'dashboard';

// Elementos principais
const loginScreen = document.getElementById('loginScreen');
const dashboardScreen = document.getElementById('dashboardScreen');
const btnRequestCode = document.getElementById('btnRequestCode');
const btnLogin = document.getElementById('btnLogin');
const btnLogout = document.getElementById('btnLogout');
const loginEmail = document.getElementById('loginEmail');
const loginCode = document.getElementById('loginCode');
const codeSection = document.getElementById('codeSection');
const loginMessage = document.getElementById('loginMessage');
const userEmail = document.getElementById('userEmail');
const apiStatus = document.getElementById('apiStatus');

// Verificar token no carregamento
window.addEventListener('DOMContentLoaded', () => {
  checkApiStatus();
  const token = localStorage.getItem('atlas_token');
  const user = localStorage.getItem('atlas_user');
  
  if (token && user) {
    currentToken = token;
    currentUser = JSON.parse(user);
    showDashboard();
    loadDashboardData();
  } else {
    showLogin();
  }
  
  setupEventListeners();
  setupNavigation();
});

// Verificar status da API
async function checkApiStatus() {
  try {
    const response = await fetch(API_BASE + '/health');
    const data = await response.json();
    if (apiStatus) {
      apiStatus.textContent = 'Online';
      apiStatus.className = 'status-value online';
    }
    return true;
  } catch (error) {
    if (apiStatus) {
      apiStatus.textContent = 'Offline';
      apiStatus.className = 'status-value';
    }
    return false;
  }
}

// Login
btnRequestCode?.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  if (!email) {
    showMessage('Digite um email', 'error');
    return;
  }
  
  btnRequestCode.disabled = true;
  btnRequestCode.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Enviando...';
  
  try {
    const response = await fetch(API_BASE + '/auth/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      showMessage(`Código enviado para ${email}`, 'success');
      codeSection.style.display = 'block';
      loginCode.focus();
    } else {
      showMessage(data.error || 'Erro ao enviar código', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  } finally {
    btnRequestCode.disabled = false;
    btnRequestCode.innerHTML = '<i class="fas fa-paper-plane"></i> Enviar Código';
  }
});

btnLogin?.addEventListener('click', async () => {
  const email = loginEmail.value.trim();
  const code = loginCode.value.trim();
  
  if (!email || !code) {
    showMessage('Preencha todos os campos', 'error');
    return;
  }
  
  btnLogin.disabled = true;
  btnLogin.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Verificando...';
  
  try {
    const response = await fetch(API_BASE + '/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      currentToken = data.token;
      currentUser = data.user;
      
      localStorage.setItem('atlas_token', currentToken);
      localStorage.setItem('atlas_user', JSON.stringify(currentUser));
      
      showDashboard();
      loadDashboardData();
      showMessage('Login realizado com sucesso!', 'success');
    } else {
      showMessage(data.error || 'Código inválido', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  } finally {
    btnLogin.disabled = false;
    btnLogin.innerHTML = '<i class="fas fa-sign-in-alt"></i> Entrar';
  }
});

// Logout
btnLogout?.addEventListener('click', () => {
  localStorage.removeItem('atlas_token');
  localStorage.removeItem('atlas_user');
  currentToken = null;
  currentUser = null;
  showLogin();
  showMessage('Sessão encerrada', 'success');
});

// Navegação
function setupNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');
  
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      
      // Ativar item
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');
      
      // Mostrar view
      const viewId = item.getAttribute('href').substring(1);
      views.forEach(view => {
        view.classList.remove('active');
        if (view.id === 'view' + capitalize(viewId)) {
          view.classList.add('active');
          currentView = viewId;
          
          // Carregar dados específicos
          if (viewId === 'dashboard') loadDashboardData();
          if (viewId === 'admin') loadAdminData();
          if (viewId === 'agenda') loadAgendaData();
          if (viewId === 'financas') loadFinancasData();
        }
      });
    });
  });
}

// Dashboard
async function loadDashboardData() {
  if (!currentToken) return;
  
  try {
    const response = await fetch(API_BASE + '/user/dashboard', {
      headers: { 'Authorization': 'Bearer ' + currentToken }
    });
    
    if (response.ok) {
      const data = await response.json();
      updateDashboard(data.dashboard);
    }
  } catch (error) {
    console.error('Erro ao carregar dashboard:', error);
  }
}

function updateDashboard(data) {
  // Estatísticas
  if (data.total_eventos !== undefined) {
    document.getElementById('totalEvents').textContent = data.total_eventos;
    document.getElementById('statEvents').textContent = data.total_eventos;
  }
  
  // Calcular finanças
  if (data.resumo && data.resumo.length > 0) {
    let income = 0;
    let expenses = 0;
    
    data.resumo.forEach(item => {
      if (item.tipo === 'income') income = parseFloat(item.total) || 0;
      if (item.tipo === 'expense') expenses = parseFloat(item.total) || 0;
    });
    
    const balance = income - expenses;
    
    document.getElementById('totalIncome').textContent = 'R$ ' + income.toFixed(2);
    document.getElementById('totalExpenses').textContent = 'R$ ' + expenses.toFixed(2);
    document.getElementById('statBalance').textContent = 'R$ ' + balance.toFixed(2);
  }
  
  // Eventos de hoje
  const today = new Date().toISOString().split('T')[0];
  const todayEvents = data.eventos?.filter(event => event.data === today) || [];
  
  const agendaList = document.getElementById('agendaList');
  if (agendaList) {
    if (todayEvents.length > 0) {
      agendaList.innerHTML = todayEvents.map(event => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(event.titulo)}</strong>
            <div style="font-size: 12px; color: #666;">
              ${event.hora || 'Dia todo'}
            </div>
          </div>
          <span class="status-badge">${event.status}</span>
        </div>
      `).join('');
    } else {
      agendaList.innerHTML = '<div class="empty-state">Nenhum evento para hoje</div>';
    }
  }
  
  // Transações recentes
  const financeList = document.getElementById('financeList');
  if (financeList && data.transacoes) {
    const recentTransactions = data.transacoes.slice(0, 5);
    
    if (recentTransactions.length > 0) {
      financeList.innerHTML = recentTransactions.map(trans => `
        <div class="list-item">
          <div>
            <strong>${escapeHtml(trans.descricao)}</strong>
            <div style="font-size: 12px; color: #666;">
              ${formatDate(trans.data)} • ${trans.categoria}
            </div>
          </div>
          <span class="${trans.tipo === 'income' ? 'income' : 'expense'}">
            ${trans.tipo === 'income' ? '+' : '-'} R$ ${parseFloat(trans.valor).toFixed(2)}
          </span>
        </div>
      `).join('');
    } else {
      financeList.innerHTML = '<div class="empty-state">Nenhuma transação</div>';
    }
  }
  
  // Total de mensagens
  if (data.total_mensagens !== undefined) {
    document.getElementById('totalMessages').textContent = data.total_mensagens;
  }
}

// Admin
async function loadAdminData() {
  try {
    const response = await fetch(API_BASE + '/admin/users', {
      headers: { 'X-ADMIN-KEY': 'admin123' }
    });
    
    if (response.ok) {
      const data = await response.json();
      updateUsersTable(data.users);
    }
  } catch (error) {
    console.error('Erro ao carregar admin:', error);
  }
}

function updateUsersTable(users) {
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  
  if (users && users.length > 0) {
    tbody.innerHTML = users.map(user => `
      <tr>
        <td>${escapeHtml(user.email)}</td>
        <td><span class="badge">${user.plano || 'FREE'}</span></td>
        <td><span class="status-badge ${user.status}">${user.status}</span></td>
        <td>
          <button class="btn btn-small" onclick="editUser('${user.id}')">
            <i class="fas fa-edit"></i>
          </button>
          <button class="btn btn-small btn-danger" onclick="deleteUser('${user.id}')">
            <i class="fas fa-trash"></i>
          </button>
        </td>
      </tr>
    `).join('');
  } else {
    tbody.innerHTML = '<tr><td colspan="4">Nenhum usuário encontrado</td></tr>';
  }
}

// WhatsApp Simulator
const chatInput = document.getElementById('chatInput');
const btnSendChat = document.getElementById('btnSendChat');
const chatMessages = document.getElementById('chatMessages');

btnSendChat?.addEventListener('click', sendWhatsAppMessage);
chatInput?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendWhatsAppMessage();
});

async function sendWhatsAppMessage() {
  const message = chatInput.value.trim();
  if (!message) return;
  
  // Adicionar mensagem do usuário
  addChatMessage(message, 'user');
  chatInput.value = '';
  
  try {
    const response = await fetch(API_BASE + '/simulator/whatsapp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ADMIN-KEY': 'admin123'
      },
      body: JSON.stringify({
        from: '5511999999999',
        message
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      addChatMessage(data.resposta, 'bot');
      
      // Atualizar dashboard se necessário
      if (data.action) {
        setTimeout(() => {
          if (currentView === 'dashboard') loadDashboardData();
        }, 500);
      }
    } else {
      addChatMessage('Erro: ' + (data.error || 'Desconhecido'), 'bot');
    }
  } catch (error) {
    addChatMessage('Erro de conexão com o servidor', 'bot');
  }
}

function addChatMessage(text, sender) {
  if (!chatMessages) return;
  
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${sender}`;
  messageDiv.innerHTML = `
    <div class="message-text">${escapeHtml(text)}</div>
  `;
  
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Event Listeners
function setupEventListeners() {
  // Botão de atualizar
  const btnRefresh = document.getElementById('btnRefresh');
  btnRefresh?.addEventListener('click', loadDashboardData);
  
  const btnRefreshUsers = document.getElementById('btnRefreshUsers');
  btnRefreshUsers?.addEventListener('click', loadAdminData);
  
  // Adicionar evento
  const btnAddEvent = document.getElementById('btnAddEvent');
  const btnAddEvent2 = document.getElementById('btnAddEvent2');
  const modalEvent = document.getElementById('modalEvent');
  const btnSaveEvent = document.getElementById('btnSaveEvent');
  
  [btnAddEvent, btnAddEvent2].forEach(btn => {
    btn?.addEventListener('click', () => {
      openModal('modalEvent');
      document.getElementById('eventDate').value = new Date().toISOString().split('T')[0];
    });
  });
  
  btnSaveEvent?.addEventListener('click', saveEvent);
  
  // Adicionar transação
  const btnAddTransaction = document.getElementById('btnAddTransaction');
  const modalTransaction = document.getElementById('modalTransaction');
  const btnSaveTransaction = document.getElementById('btnSaveTransaction');
  
  btnAddTransaction?.addEventListener('click', () => {
    openModal('modalTransaction');
    document.getElementById('transactionDate').value = new Date().toISOString().split('T')[0];
  });
  
  btnSaveTransaction?.addEventListener('click', saveTransaction);
  
  // Toggle buttons
  const toggleButtons = document.querySelectorAll('.toggle-btn');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      toggleButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  
  // Fechar modais
  const closeButtons = document.querySelectorAll('.modal-close');
  closeButtons.forEach(btn => {
    btn.addEventListener('click', closeAllModals);
  });
  
  // Fechar modal clicando fora
  const modals = document.querySelectorAll('.modal');
  modals.forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeAllModals();
    });
  });
}

// Funções CRUD
async function saveEvent() {
  const title = document.getElementById('eventTitle').value.trim();
  const date = document.getElementById('eventDate').value;
  const time = document.getElementById('eventTime').value;
  const description = document.getElementById('eventDescription').value.trim();
  
  if (!title || !date) {
    showMessage('Título e data são obrigatórios', 'error');
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/user/event', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + currentToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        titulo: title,
        descricao: description,
        data: date,
        hora: time || null
      })
    });
    
    if (response.ok) {
      closeAllModals();
      showMessage('Evento salvo com sucesso!', 'success');
      loadDashboardData();
    } else {
      const data = await response.json();
      showMessage(data.error || 'Erro ao salvar evento', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  }
}

async function saveTransaction() {
  const type = document.querySelector('.toggle-btn.active')?.getAttribute('data-type');
  const description = document.getElementById('transactionDesc').value.trim();
  const value = document.getElementById('transactionValue').value;
  const date = document.getElementById('transactionDate').value;
  const category = document.getElementById('transactionCategory').value;
  
  if (!type || !description || !value || !date) {
    showMessage('Preencha todos os campos', 'error');
    return;
  }
  
  const valueNum = parseFloat(value);
  if (isNaN(valueNum) || valueNum <= 0) {
    showMessage('Valor inválido', 'error');
    return;
  }
  
  try {
    const response = await fetch(API_BASE + '/user/transacao', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + currentToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tipo: type,
        descricao: description,
        valor: valueNum,
        data: date,
        categoria: category
      })
    });
    
    if (response.ok) {
      closeAllModals();
      showMessage('Transação salva com sucesso!', 'success');
      loadDashboardData();
    } else {
      const data = await response.json();
      showMessage(data.error || 'Erro ao salvar transação', 'error');
    }
  } catch (error) {
    showMessage('Erro de conexão', 'error');
  }
}

// Utilitários
function showLogin() {
  loginScreen.classList.add('active');
  dashboardScreen.classList.remove('active');
  loginEmail.value = '';
  loginCode.value = '';
  codeSection.style.display = 'none';
}

function showDashboard() {
  loginScreen.classList.remove('active');
  dashboardScreen.classList.add('active');
  if (currentUser) {
    userEmail.textContent = currentUser.email;
  }
}

function showMessage(text, type) {
  if (!loginMessage) return;
  
  loginMessage.textContent = text;
  loginMessage.className = `message ${type}`;
  
  setTimeout(() => {
    loginMessage.textContent = '';
    loginMessage.className = 'message';
  }, 3000);
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeAllModals() {
  document.querySelectorAll('.modal').forEach(modal => {
    modal.classList.remove('active');
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleDateString('pt-BR');
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Exportar funções globais
window.editUser = function(userId) {
  console.log('Editar usuário:', userId);
  // Implementar edição
};

window.deleteUser = function(userId) {
  if (confirm('Excluir este usuário?')) {
    console.log('Excluir usuário:', userId);
    // Implementar exclusão
  }
};

// Load agenda and financas (simplificado)
async function loadAgendaData() {
  try {
    const response = await fetch(API_BASE + '/user/dashboard', {
      headers: { 'Authorization': 'Bearer ' + currentToken }
    });
    
    if (response.ok) {
      const data = await response.json();
      const agendaList = document.getElementById('fullAgendaList');
      if (agendaList) {
        agendaList.innerHTML = data.dashboard.eventos?.map(event => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(event.titulo)}</strong>
              <div>${formatDate(event.data)} ${event.hora || ''}</div>
            </div>
            <span class="status-badge">${event.status}</span>
          </div>
        `).join('') || '<div class="empty-state">Nenhum evento</div>';
      }
    }
  } catch (error) {
    console.error('Erro agenda:', error);
  }
}

async function loadFinancasData() {
  try {
    const response = await fetch(API_BASE + '/user/dashboard', {
      headers: { 'Authorization': 'Bearer ' + currentToken }
    });
    
    if (response.ok) {
      const data = await response.json();
      const financeList = document.getElementById('fullFinanceList');
      if (financeList) {
        financeList.innerHTML = data.dashboard.transacoes?.map(trans => `
          <div class="list-item">
            <div>
              <strong>${escapeHtml(trans.descricao)}</strong>
              <div>${formatDate(trans.data)} • ${trans.categoria}</div>
            </div>
            <span class="${trans.tipo === 'income' ? 'income' : 'expense'}">
              ${trans.tipo === 'income' ? '+' : '-'} R$ ${parseFloat(trans.valor).toFixed(2)}
            </span>
          </div>
        `).join('') || '<div class="empty-state">Nenhuma transação</div>';
      }
    }
  } catch (error) {
    console.error('Erro finanças:', error);
  }
}
