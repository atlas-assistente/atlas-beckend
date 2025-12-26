const API="https://atlas-beckend.onrender.com/api";

const email = document.getElementById("email");
const code = document.getElementById("code");
const send = document.getElementById("send");
const login = document.getElementById("login");
const msg = document.getElementById("msg");
const box = document.getElementById("codeBox");

send.onclick = async () => {
  msg.innerText="Enviando...";
  const r = await fetch(API+"/auth/request",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:email.value})
  });
  const d = await r.json();
  if(!r.ok) return msg.innerText = d.error || "Erro";
  msg.innerText = "Código enviado";
  box.style.display="block";
};

login.onclick = async () => {
  msg.innerText="Entrando...";
  const r = await fetch(API+"/auth/verify",{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({email:email.value,code:code.value})
  });
  const d = await r.json();
  if(!r.ok) return msg.innerText = d.error || "Erro";
  localStorage.setItem("atlas_token", d.token);
  msg.innerText = "Logado";
};
