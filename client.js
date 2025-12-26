const API = "https://atlas-backend.onrender.com";

async function login(){
  const email = document.getElementById("email").value;

  const res = await fetch(API + "/client/login", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ email })
  });

  const data = await res.json();

  if(data.ok){
    localStorage.setItem("atlas_user", data.user.id);
    window.location = "dashboard.html";
  } else {
    alert("Usuário não encontrado");
  }
}
