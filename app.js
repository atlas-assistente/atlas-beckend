// ===========================
// ATLAS FRONTEND (SPA)
// ===========================

const API_BASE = "https://atlas-beckend.onrender.com/api";


const elApiHostText = document.getElementById("apiHostText");
const elSessionLabel = document.getElementById("sessionLabel");
const elStatusLabel = document.getElementById("statusLabel");
const elBtnLogout = document.getElementById("btnLogout");

const views = {
  login: document.getElementById("viewLogin"),
  admin: document.getElementById("viewAdmin"),
  app: document.getElementById("viewApp"),
  chat: document.getElementById("viewChat")
};

const nav = {
  admin: document.getElementById("navAdmin"),
  app: document.getElementById("navApp"),
  chat: document.getElementById("navChat")
};

const toast = document.getElementById("toast");
function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = "block";
  setTimeout(() => (toast.style.display = "none"), 2200);
}

elApiHostText.textContent = API_BASE;

function getAdminKey() {
  return localStorage.getItem("atlas_admin_key") || "";
}
function setAdminKey(v) {
  localStorage.setItem("atlas_admin_key", v);
}
function clearSession() {
  localStorage.removeItem("atlas_admin_key");
}

function setStatus(text) {
  elStatusLabel.textContent = text;
}

async function pingApi() {
  try {
    const r = await fetch(`${API_BASE}/health`);
    if (!r.ok) throw new Error("health not ok");
    setStatus("online");
  } catch {
    setStatus("offline");
  }
}

// ---------------------------
// Router
// ---------------------------
function hideAllViews() {
  Object.values(views).forEach(v => v.classList.remove("show"));
  Object.values(nav).forEach(v => v.classList.remove("active"));
}

function route() {
  const hash = (location.hash || "#/login").toLowerCase();
  const adminKey = getAdminKey();
  const session = adminKey ? "Admin" : "Visitante";
  elSessionLabel.textContent = session;

  hideAllViews();

  if (!adminKey && (hash.startsWith("#/admin") || hash.startsWith("#/app") || hash.startsWith("#/chat"))) {
    views.login.classList.add("show");
    return;
  }

  if (hash.startsWith("#/admin")) {
    views.admin.classList.add("show");
    nav.admin.classList.add("active");
    loadUsers();
    return;
  }

  if (hash.startsWith("#/chat")) {
    views.chat.classList.add("show");
    nav.chat.classList.add("active");
    return;
  }

  if (hash.startsWith("#/app")) {
    loadDashboard();
    views.app.classList.add("show");
    nav.app.classList.add("active");
    return;
  }

  views.login.classList.add("show");
}

window.addEventListener("hashchange", route);

// ---------------------------
// Login
// ---------------------------
const adminKeyInput = document.getElementById("adminKeyInput");
const btnSaveAdminKey = document.getElementById("btnSaveAdminKey");
const btnGoAdmin = document.getElementById("btnGoAdmin");

btnSaveAdminKey.addEventListener("click", () => {
  const v = adminKeyInput.value.trim();
  if (!v) return showToast("Cole a chave Admin.");
  setAdminKey(v);
  showToast("Chave salva.");
  location.hash = "#/admin";
});

btnGoAdmin.addEventListener("click", () => {
  location.hash = "#/admin";
});

elBtnLogout.addEventListener("click", () => {
  clearSession();
  showToast("Sessão encerrada.");
  location.hash = "#/login";
});

// ---------------------------
// Admin Users
// ---------------------------
const usersTbody = document.getElementById("usersTbody");
const btnRefreshUsers = document.getElementById("btnRefreshUsers");
const btnOpenCreateUser = document.getElementById("btnOpenCreateUser");

const editUserId = document.getElementById("editUserId");
const userEmail = document.getElementById("userEmail");
const userNome = document.getElementById("userNome");
const userPlano = document.getElementById("userPlano");
const userStatus = document.getElementById("userStatus");
const userPhone = document.getElementById("userPhone");

const btnSaveUser = document.getElementById("btnSaveUser");
const btnClearForm = document.getElementById("btnClearForm");

btnRefreshUsers.addEventListener("click", loadUsers);
btnOpenCreateUser.addEventListener("click", () => {
  editUserId.value = "";
  userEmail.value = "";
  userNome.value = "";
  userPlano.value = "FREE";
  userStatus.value = "active";
  userPhone.value = "";
  showToast("Form pronto para criar.");
});

btnClearForm.addEventListener("click", () => {
  editUserId.value = "";
  userEmail.value = "";
  userNome.value = "";
  userPlano.value = "FREE";
  userStatus.value = "active";
  userPhone.value = "";
  showToast("Limpo.");
});

function adminHeaders() {
  const k = getAdminKey();
  return {
    "Content-Type": "application/json",
    "X-ADMIN-KEY": k
  };
}

function badgeForStatus(st) {
  const s = (st || "").toLowerCase();
  if (s === "active") return `<span class="badge ok"><span class="badge-dot"></span>active</span>`;
  if (s === "blocked") return `<span class="badge bad"><span class="badge-dot"></span>blocked</span>`;
  return `<span class="badge warn"><span class="badge-dot"></span>${escapeHtml(st || "inactive")}</span>`;
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadUsers() {
  usersTbody.innerHTML = `<tr><td colspan="6" class="atlas-td-muted">Carregando…</td></tr>`;
  try {
    const r = await fetch(`${API_BASE}/admin/users`, { headers: adminHeaders() });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || "Falha ao carregar usuários.");

    if (!data?.users?.length) {
      usersTbody.innerHTML = `<tr><td colspan="6" class="atlas-td-muted">Nenhum usuário ainda.</td></tr>`;
      return;
    }

    usersTbody.innerHTML = data.users.map(u => {
      const phone = u.phone ? escapeHtml(u.phone) : "—";
      return `
        <tr>
          <td>${escapeHtml(u.email)}</td>
          <td>${escapeHtml(u.nome || "—")}</td>
          <td><span class="badge"><span class="badge-dot"></span>${escapeHtml(u.plano || "FREE")}</span></td>
          <td>${badgeForStatus(u.status)}</td>
          <td>${phone}</td>
          <td>
            <div class="row-actions">
              <button class="btn-mini primary" data-act="edit" data-id="${u.id}">Editar</button>
              <button class="btn-mini" data-act="toggle" data-id="${u.id}" data-status="${escapeHtml(u.status)}">Bloquear/Ativar</button>
              <button class="btn-mini danger" data-act="delete" data-id="${u.id}">Excluir</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

  } catch (e) {
    usersTbody.innerHTML = `<tr><td colspan="6" class="atlas-td-muted">Erro: ${escapeHtml(e.message)}</td></tr>`;
  }
}

usersTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const act = btn.getAttribute("data-act");
  const id = btn.getAttribute("data-id");
  if (!act || !id) return;

  if (act === "edit") {
    await fillUserForm(id);
    return;
  }

  if (act === "toggle") {
    const current = (btn.getAttribute("data-status") || "").toLowerCase();
    const next = current === "active" ? "blocked" : "active";
    await updateUser(id, { status: next });
    await loadUsers();
    showToast(`Status atualizado: ${next}`);
    return;
  }

  if (act === "delete") {
    const ok = confirm("Excluir usuário? (ação real)");
    if (!ok) return;
    await deleteUser(id);
    await loadUsers();
    showToast("Usuário excluído.");
  }
});

async function fillUserForm(id) {
  try {
    const r = await fetch(`${API_BASE}/admin/users/${id}`, { headers: adminHeaders() });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || "Falha ao carregar usuário.");

    editUserId.value = data.user.id;
    userEmail.value = data.user.email || "";
    userNome.value = data.user.nome || "";
    userPlano.value = data.user.plano || "FREE";
    userStatus.value = data.user.status || "active";
    userPhone.value = data.user.phone || "";
    showToast("Carregado para edição.");
  } catch (e) {
    showToast(`Erro: ${e.message}`);
  }
}

btnSaveUser.addEventListener("click", async () => {
  const id = editUserId.value.trim() || null;
  const payload = {
    email: userEmail.value.trim(),
    nome: userNome.value.trim(),
    plano: userPlano.value.trim(),
    status: userStatus.value.trim(),
    phone: userPhone.value.trim()
  };

  if (!payload.email) return showToast("E-mail é obrigatório.");

  try {
    if (!id) {
      await createUser(payload);
      showToast("Usuário criado.");
    } else {
      await updateUser(id, payload);
      showToast("Usuário atualizado.");
    }
    await loadUsers();
  } catch (e) {
    showToast(`Erro: ${e.message}`);
  }
});

async function createUser(payload) {
  const r = await fetch(`${API_BASE}/admin/users`, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao criar usuário.");
}

async function updateUser(id, payload) {
  const r = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao atualizar usuário.");
}

async function deleteUser(id) {
  const r = await fetch(`${API_BASE}/admin/users/${id}`, {
    method: "DELETE",
    headers: adminHeaders()
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "Falha ao excluir usuário.");
}

// ---------------------------
// Chat Simulator
// ---------------------------
const chatBody = document.getElementById("chatBody");
const chatFrom = document.getElementById("chatFrom");
const chatMessage = document.getElementById("chatMessage");
const btnSendChat = document.getElementById("btnSendChat");
const btnClearChat = document.getElementById("btnClearChat");

function addBubble(text, who) {
  const div = document.createElement("div");
  div.className = `atlas-chat-bubble ${who === "me" ? "me" : "atlas"}`;
  div.textContent = text;
  chatBody.appendChild(div);
  chatBody.scrollTop = chatBody.scrollHeight;
}

btnClearChat.addEventListener("click", () => {
  chatBody.innerHTML = "";
  showToast("Chat limpo.");
});

btnSendChat.addEventListener("click", sendChat);
chatMessage.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChat();
});

async function sendChat() {
  const from = (chatFrom.value || "").trim() || "5548999999999";
  const message = (chatMessage.value || "").trim();
  if (!message) return;

  addBubble(message, "me");
  chatMessage.value = "";

  try {
    const r = await fetch(`${API_BASE}/simulator/whatsapp`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ from, message })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || "Falha no simulador.");

    addBubble(data.reply || "OK", "atlas");
  } catch (e) {
    addBubble(`Erro: ${e.message}`, "atlas");
  }
}

// init
(async function init(){
  await pingApi();
  route();

async function loadDashboard() {
  try {
    const agenda = await fetch(`${API_BASE}/dashboard/agenda`, {
      headers: adminHeaders()
    }).then(r => r.json());

    const finance = await fetch(`${API_BASE}/dashboard/finance`, {
      headers: adminHeaders()
    }).then(r => r.json());

    const agendaBox = document.querySelector("#agendaBox");
    const financeBox = document.querySelector("#financeBox");

    if (agenda.items.length === 0) {
      agendaBox.innerHTML = "Nenhum registro ainda.";
    } else {
      agendaBox.innerHTML = agenda.items
        .map(i => `${i.from_phone} → ${i.text}`)
        .join("<br>");
    }

    financeBox.innerHTML = `
      Entradas: R$ ${finance.income || 0}<br>
      Saídas: R$ ${finance.expense || 0}
    `;

  } catch (e) {
    console.error(e);
  }
}

  
})();
