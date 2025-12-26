const API = "https://atlas-backend.onrender.com";
const key = localStorage.getItem("atlas_admin");

function load(){
fetch(API+"/admin/users",{
 headers:{ "X-ADMIN-KEY":key }
})
.then(r=>r.json())
.then(d=>{
 t.innerHTML="";
 d.users.forEach(u=>{
   t.innerHTML+=`<tr><td>${u.email}</td><td>${u.plano}</td></tr>`;
 });
});
}
load();
