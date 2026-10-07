const MODEL = "@cf/meta/llama-3.2-3b-instruct";

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

function html() {
  return new Response(HTML, {headers: {"content-type":"text/html; charset=utf-8"}});
}

async function sb(env, path, options={}, token) {
  const headers = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token || env.SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type":"application/json",
    ...(options.headers || {})
  };
  const r = await fetch(env.SUPABASE_URL + "/rest/v1/" + path, {...options, headers});
  const text = await r.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new Error(typeof data === "object" ? JSON.stringify(data) : data);
  return data;
}

function tokenFrom(req) {
  const h=req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function api(req, env) {
  const token=tokenFrom(req);
  if (!token) return json({error:"Connexion requise."},401);
  const url=new URL(req.url);
  const p=url.pathname;

  try {
    if (p==="/api/me" && req.method==="GET") {
      const data=await sb(env,"businesses?select=*&order=created_at.asc&limit=1",{method:"GET"},token);
      return json({business:data?.[0] || null});
    }

    if (p==="/api/business" && req.method==="POST") {
      const body=await req.json();
      const user=await sb(env,"",{method:"GET"},token).catch(()=>null);
      void user;
      const auth=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`}});
      if(!auth.ok) return json({error:"Session invalide."},401);
      const u=await auth.json();
      const data=await sb(env,"businesses",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
        owner_id:u.id,name:body.name,type:body.type||null,description:body.description||null,
        phone:body.phone||null,whatsapp:body.whatsapp||null,city:body.city||null,
        address:body.address||null,opening_hours:body.opening_hours||null,objective:body.objective||null
      })},token);
      return json({business:data?.[0] || null},201);
    }

    if (p==="/api/products" && req.method==="GET") {
      const b=await sb(env,"businesses?select=id&limit=1",{method:"GET"},token);
      if(!b?.[0]) return json({products:[]});
      const products=await sb(env,`products?select=*&business_id=eq.${b[0].id}&order=created_at.desc`,{method:"GET"},token);
      return json({products});
    }

    if (p==="/api/products" && req.method==="POST") {
      const b=await sb(env,"businesses?select=id&limit=1",{method:"GET"},token);
      if(!b?.[0]) return json({error:"Crée d'abord ton activité."},400);
      const body=await req.json();
      const data=await sb(env,"products",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
        business_id:b[0].id,name:body.name,description:body.description||null,
        price:Number(body.price)||0,stock:Math.max(0,Number(body.stock)||0),
        category:body.category||null,available:true
      })},token);
      return json({product:data?.[0]},201);
    }

    if (p==="/api/sales" && req.method==="POST") {
      const b=await sb(env,"businesses?select=id&limit=1",{method:"GET"},token);
      if(!b?.[0]) return json({error:"Crée d'abord ton activité."},400);
      const body=await req.json();
      const sale=await sb(env,"sales",{method:"POST",headers:{"Prefer":"return=representation"},body:JSON.stringify({
        business_id:b[0].id,total:Number(body.total)||0,payment_method:body.payment_method||"cash"
      })},token);
      return json({sale:sale?.[0]},201);
    }

    if (p==="/api/assistant" && req.method==="POST") {
      if(!env.AI) return json({error:"IA Cloudflare non configurée."},503);
      const body=await req.json();
      const businesses=await sb(env,"businesses?select=*&limit=1",{method:"GET"},token);
      if(!businesses?.[0]) return json({error:"Crée d'abord ton activité."},400);
      const b=businesses[0];
      const products=await sb(env,`products?select=name,description,price,stock,available&business_id=eq.${b.id}&order=name.asc`,{method:"GET"},token);
      const context=JSON.stringify({activité:b,produits});
      const system=`Tu es Mon Assistant Pro. Tu aides le propriétaire à développer son activité. Sois concret, simple et orienté résultats. Utilise uniquement les données fournies. N'invente jamais prix, produits, ventes ou résultats. Si une donnée manque, dis-le. Donne une prochaine action réalisable. Réponds en français. Données: ${context}`;
      const result=await env.AI.run(MODEL,{messages:[{role:"system",content:system},{role:"user",content:String(body.message||"") }],max_tokens:450,temperature:0.4});
      return json({answer:result?.response || "Je n'ai pas pu répondre."});
    }

    return json({error:"Route inconnue."},404);
  } catch(e) {
    return json({error:"Erreur serveur.",detail:String(e.message||e)},500);
  }
}

export default {
  async fetch(req, env) {
    const url=new URL(req.url);
    if(url.pathname.startsWith("/api/")) return api(req,env);
    return html();
  }
};

const HTML = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mon Assistant Pro</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#f6f7fb;color:#172033}header{background:#111827;color:white;padding:18px 20px;display:flex;justify-content:space-between;align-items:center}main{max-width:1050px;margin:24px auto;padding:0 16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{background:white;border:1px solid #e5e7eb;border-radius:18px;padding:18px;box-shadow:0 5px 20px #00000008}h1,h2{margin-top:0}.muted{color:#667085}.row{display:flex;gap:10px;flex-wrap:wrap}input,textarea,select,button{font:inherit;padding:11px;border-radius:10px;border:1px solid #d0d5dd;width:100%}button{background:#111827;color:white;cursor:pointer;border:0}.small{width:auto}.danger{background:#e11d48}.hide{display:none}.msg{padding:10px;border-radius:10px;background:#f2f4f7;margin:7px 0}.assistant{max-height:300px;overflow:auto}
</style></head><body>
<header><strong>Mon Assistant Pro</strong><button id="logout" class="small hide">Déconnexion</button></header>
<main>
<section id="auth" class="card">
<h1>Votre assistant commercial</h1><p class="muted">Connectez-vous pour gérer votre activité et travailler avec votre Assistant Pro.</p>
<div class="grid"><div><h2>Créer un compte</h2><input id="suEmail" placeholder="Email"><input id="suPass" type="password" placeholder="Mot de passe"><button id="signup">Créer mon compte</button></div>
<div><h2>Se connecter</h2><input id="siEmail" placeholder="Email"><input id="siPass" type="password" placeholder="Mot de passe"><button id="signin">Se connecter</button></div></div><p id="authMsg"></p></section>

<section id="app" class="hide">
<div id="setup" class="card hide"><h1>Commençons par votre activité</h1><p class="muted">Quelques informations suffisent pour que l'assistant puisse vous aider.</p>
<div class="grid"><input id="bName" placeholder="Nom de votre activité"><input id="bType" placeholder="Type d'activité"><input id="bCity" placeholder="Ville"><input id="bPhone" placeholder="Téléphone / WhatsApp"></div><textarea id="bDesc" placeholder="Que vendez-vous ou quel service proposez-vous ?"></textarea><textarea id="bObj" placeholder="Votre objectif principal"></textarea><button id="createBusiness">Créer mon activité</button></div>

<div id="dashboard" class="hide"><div class="grid">
<div class="card"><h2>Mon activité</h2><div id="businessInfo"></div></div>
<div class="card"><h2>Ajouter un produit</h2><input id="pName" placeholder="Nom"><input id="pPrice" type="number" placeholder="Prix"><input id="pStock" type="number" placeholder="Stock"><button id="addProduct">Ajouter</button></div>
</div>
<div class="grid" style="margin-top:16px"><div class="card"><h2>Produits</h2><div id="products"></div></div>
<div class="card"><h2>Assistant Pro</h2><div id="chat" class="assistant"></div><textarea id="question" placeholder="Ex. Comment puis-je vendre plus cette semaine ?"></textarea><button id="ask">Demander conseil</button></div></div></div>
</section>
</main>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
const sb=supabase.createClient("https://mpskusndhblcxzcikzey.supabase.co","sb_publishable_W-5z7pwEpUFAKS6YY__l0A_OXi1cBGU");
const $=id=>document.getElementById(id);
async function session(){return (await sb.auth.getSession()).data.session}
async function call(path,opts={}){const s=await session(); if(!s) throw Error("Connexion requise"); const r=await fetch(path,{...opts,headers:{"Content-Type":"application/json","Authorization":"Bearer "+s.access_token,...(opts.headers||{})}}); const d=await r.json(); if(!r.ok) throw Error(d.error||"Erreur"); return d}
async function refresh(){const d=await call("/api/me"); $("setup").classList.toggle("hide",!!d.business); $("dashboard").classList.toggle("hide",!d.business); if(d.business){$("businessInfo").innerHTML="<b>"+d.business.name+"</b><br>"+(d.business.type||"")+"<br>"+(d.business.city||""); await loadProducts()}}
async function loadProducts(){const d=await call("/api/products"); $("products").innerHTML=d.products.length?d.products.map(p=>"<div class='msg'><b>"+p.name+"</b> — "+Number(p.price).toLocaleString()+" FCFA<br>Stock: "+p.stock+"</div>").join(""):"Aucun produit."}
$("signup").onclick=async()=>{try{const r=await sb.auth.signUp({email:$("suEmail").value,password:$("suPass").value});$("authMsg").textContent=r.error?.message||"Compte créé. Vérifiez votre email si Supabase le demande."}catch(e){$("authMsg").textContent=e.message}}
$("signin").onclick=async()=>{try{const r=await sb.auth.signInWithPassword({email:$("siEmail").value,password:$("siPass").value});if(r.error)throw r.error; $("auth").classList.add("hide");$("app").classList.remove("hide");$("logout").classList.remove("hide");await refresh()}catch(e){$("authMsg").textContent=e.message}}
$("logout").onclick=async()=>{await sb.auth.signOut();location.reload()}
$("createBusiness").onclick=async()=>{try{await call("/api/business",{method:"POST",body:JSON.stringify({name:$("bName").value,type:$("bType").value,city:$("bCity").value,phone:$("bPhone").value,description:$("bDesc").value,objective:$("bObj").value})});await refresh()}catch(e){alert(e.message)}}
$("addProduct").onclick=async()=>{try{await call("/api/products",{method:"POST",body:JSON.stringify({name:$("pName").value,price:$("pPrice").value,stock:$("pStock").value})});$("pName").value="";$("pPrice").value="";$("pStock").value="";await loadProducts()}catch(e){alert(e.message)}}
$("ask").onclick=async()=>{const q=$("question").value.trim();if(!q)return; $("chat").innerHTML+="<div class='msg'><b>Vous :</b> "+q+"</div>";$("question").value="";try{const d=await call("/api/assistant",{method:"POST",body:JSON.stringify({message:q})});$("chat").innerHTML+="<div class='msg'><b>Assistant :</b> "+d.answer.replace(/\n/g,"<br>")+"</div>"}catch(e){$("chat").innerHTML+="<div class='msg'>Erreur : "+e.message+"</div>"}}
sb.auth.onAuthStateChange((event,session)=>{if(session){$("auth").classList.add("hide");$("app").classList.remove("hide");$("logout").classList.remove("hide");refresh()}})
(async()=>{const s=await session();if(s){$("auth").classList.add("hide");$("app").classList.remove("hide");$("logout").classList.remove("hide");await refresh()}})();
</script></body></html>`;
