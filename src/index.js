const MODEL = "@cf/meta/llama-3.2-3b-instruct";

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store"}
  });
}

async function sb(env, path, options={}, token) {
  const headers = {
    apikey: env.SUPABASE_PUBLISHABLE_KEY,
    Authorization: "Bearer " + (token || env.SUPABASE_PUBLISHABLE_KEY),
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

async function currentBusiness(env, token) {
  const rows = await sb(env, "businesses?select=*&order=created_at.asc&limit=1", {method:"GET"}, token);
  return rows && rows[0] ? rows[0] : null;
}

async function api(req, env) {
  const token=tokenFrom(req);
  if (!token) return json({error:"Connexion requise."},401);
  const url=new URL(req.url);
  const p=url.pathname;

  try {
    if (p==="/api/me" && req.method==="GET") {
      const b=await currentBusiness(env,token);
      return json({business:b});
    }

    if (p==="/api/business" && req.method==="POST") {
      const body=await req.json();
      const auth=await fetch(env.SUPABASE_URL+"/auth/v1/user",{
        headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+token}
      });
      if(!auth.ok) return json({error:"Session invalide."},401);
      const u=await auth.json();
      const existing=await currentBusiness(env,token);
      if(existing) return json({business:existing});
      const data=await sb(env,"businesses",{
        method:"POST",
        headers:{"Prefer":"return=representation"},
        body:JSON.stringify({
          owner_id:u.id,
          name:String(body.name||"").trim(),
          type:body.type||null,
          description:body.description||null,
          phone:body.phone||null,
          whatsapp:body.whatsapp||null,
          city:body.city||null,
          address:body.address||null,
          opening_hours:body.opening_hours||null,
          objective:body.objective||null
        })
      },token);
      return json({business:data?.[0]||null},201);
    }

    if (p==="/api/products" && req.method==="GET") {
      const b=await currentBusiness(env,token);
      if(!b) return json({products:[]});
      const products=await sb(env,"products?select=*&business_id=eq."+b.id+"&order=created_at.desc",{method:"GET"},token);
      return json({products});
    }

    if (p==="/api/products" && req.method==="POST") {
      const b=await currentBusiness(env,token);
      if(!b) return json({error:"Crée d'abord ton activité."},400);
      const body=await req.json();
      const name=String(body.name||"").trim();
      if(!name) return json({error:"Le nom du produit est obligatoire."},400);
      const data=await sb(env,"products",{
        method:"POST",
        headers:{"Prefer":"return=representation"},
        body:JSON.stringify({
          business_id:b.id,
          name:name,
          description:body.description||null,
          price:Math.max(0,Number(body.price)||0),
          stock:Math.max(0,Number(body.stock)||0),
          category:body.category||null,
          available:true
        })
      },token);
      return json({product:data?.[0]||null},201);
    }

    if (p==="/api/sales" && req.method==="GET") {
      const b=await currentBusiness(env,token);
      if(!b) return json({sales:[]});
      const sales=await sb(env,"sales?select=*&business_id=eq."+b.id+"&order=created_at.desc&limit=100",{method:"GET"},token);
      return json({sales});
    }

    if (p==="/api/sales" && req.method==="POST") {
      const b=await currentBusiness(env,token);
      if(!b) return json({error:"Crée d'abord ton activité."},400);
      const body=await req.json();
      const total=Math.max(0,Number(body.total)||0);
      if(!total) return json({error:"Le montant de la vente doit être supérieur à 0."},400);
      const sale=await sb(env,"sales",{
        method:"POST",
        headers:{"Prefer":"return=representation"},
        body:JSON.stringify({
          business_id:b.id,
          customer_id:body.customer_id||null,
          total:total,
          payment_method:body.payment_method||"cash"
        })
      },token);
      return json({sale:sale?.[0]||null},201);
    }

    if (p==="/api/customers" && req.method==="GET") {
      const b=await currentBusiness(env,token);
      if(!b) return json({customers:[]});
      const customers=await sb(env,"customers?select=*&business_id=eq."+b.id+"&order=updated_at.desc&limit=100",{method:"GET"},token);
      return json({customers});
    }

    if (p==="/api/summary" && req.method==="GET") {
      const b=await currentBusiness(env,token);
      if(!b) return json({summary:null});
      const since=new Date();
      since.setHours(0,0,0,0);
      const iso=encodeURIComponent(since.toISOString());
      const sales=await sb(env,"sales?select=total,created_at&business_id=eq."+b.id+"&created_at=gte."+iso,{method:"GET"},token);
      const products=await sb(env,"products?select=id,name,price,stock,available&business_id=eq."+b.id+"&order=name.asc",{method:"GET"},token);
      const total=(sales||[]).reduce((s,x)=>s+Number(x.total||0),0);
      const avg=sales&&sales.length?total/sales.length:0;
      return json({summary:{salesCount:(sales||[]).length,total,average:avg,productsCount:(products||[]).length,lowStock:(products||[]).filter(x=>Number(x.stock||0)<=5).length}});
    }

    if (p==="/api/assistant" && req.method==="POST") {
      if(!env.AI) return json({error:"IA Cloudflare non configurée."},503);
      const body=await req.json();
      const b=await currentBusiness(env,token);
      if(!b) return json({error:"Crée d'abord ton activité."},400);
      const products=await sb(env,"products?select=name,description,price,stock,available,category&business_id=eq."+b.id+"&order=name.asc",{method:"GET"},token);
      const recentSales=await sb(env,"sales?select=total,created_at,payment_method&business_id=eq."+b.id+"&order=created_at.desc&limit=20",{method:"GET"},token);
      const context=JSON.stringify({activite:b,produits:products,ventes_recentes:recentSales});
      const system="Tu es Mon Assistant Pro, copilote commercial d'un entrepreneur. Aide à obtenir des résultats concrets. Utilise uniquement les données fournies. N'invente jamais prix, produits, ventes, clients, promotions ou résultats. Si une donnée manque, dis-le. Donne une recommandation priorisée et une action immédiatement réalisable. Réponds en français simple, professionnel et encourageant. Données: "+context;
      const result=await env.AI.run(MODEL,{
        messages:[
          {role:"system",content:system},
          {role:"user",content:String(body.message||"")}
        ],
        max_tokens:500,
        temperature:0.35
      });
      const answer=result?.response||"Je n'ai pas pu répondre.";
      try {
        await sb(env,"ai_usage",{
          method:"POST",
          body:JSON.stringify({
            business_id:b.id,
            model:MODEL,
            input_tokens:Number(result?.usage?.prompt_tokens||0),
            output_tokens:Number(result?.usage?.completion_tokens||0),
            neurons:Number(result?.neurons||0)
          })
        },token);
      } catch {}
      return json({answer});
    }

    return json({error:"Route inconnue."},404);
  } catch(e) {
    return json({error:"Une erreur est survenue."},500);
  }
}

export default {
  async fetch(req, env) {
    const url=new URL(req.url);
    if(url.pathname.startsWith("/api/")) return api(req,env);
    return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
  }
};

const HTML = String.raw`<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Mon Assistant Pro — Votre copilote commercial</title>
<style>
:root{--bg:#f6f7fb;--panel:#fff;--ink:#101828;--muted:#667085;--line:#eaecf0;--brand:#635bff;--brand2:#7c3aed;--soft:#f0efff;--success:#079455;--warning:#dc6803;--danger:#d92d20;--shadow:0 18px 55px rgba(16,24,40,.08)}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}button,input,textarea,select{font:inherit}button{cursor:pointer}
.hidden{display:none!important}.app{min-height:100vh}.login{min-height:100vh;display:grid;grid-template-columns:1.1fr .9fr;background:#fff}.login-hero{padding:7vw;background:linear-gradient(145deg,#111827 0%,#1f2350 55%,#635bff 100%);color:#fff;position:relative;overflow:hidden}.login-hero:after{content:"";position:absolute;width:420px;height:420px;border-radius:50%;right:-170px;bottom:-160px;background:rgba(255,255,255,.08)}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.03em}.logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#fff,#c4b5fd);display:grid;place-items:center;color:#4f46e5;font-weight:900}.hero-copy{max-width:620px;margin-top:13vh}.hero-copy h1{font-size:clamp(38px,5vw,72px);line-height:.98;letter-spacing:-.055em;margin:0 0 22px}.hero-copy p{font-size:19px;line-height:1.6;color:#d8dbe8;max-width:540px}.pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.1);color:#e7e9f4;font-size:13px;font-weight:700;margin-bottom:18px}.login-box{display:grid;place-items:center;padding:30px}.auth-card{width:min(440px,100%);padding:38px;border:1px solid var(--line);border-radius:28px;box-shadow:var(--shadow);background:#fff}.auth-card h2{font-size:30px;letter-spacing:-.04em;margin:0 0 8px}.muted{color:var(--muted)}.field{margin:14px 0}.field label{display:block;font-size:13px;font-weight:700;margin-bottom:7px}.field input,.field textarea,.field select{width:100%;border:1px solid #d0d5dd;border-radius:13px;padding:13px 14px;outline:none;background:#fff}.field input:focus,.field textarea:focus,.field select:focus{border-color:#8b82ff;box-shadow:0 0 0 4px rgba(99,91,255,.1)}.btn{border:0;border-radius:13px;padding:13px 17px;font-weight:800;transition:.2s}.btn:hover{transform:translateY(-1px)}.btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff}.btn-secondary{background:#fff;border:1px solid #d0d5dd;color:var(--ink)}.btn-soft{background:var(--soft);color:#5146b8}.btn-danger{background:#fff1f0;color:var(--danger)}.full{width:100%}.switch{text-align:center;margin-top:18px;font-size:14px}.link{color:#5146b8;font-weight:800;cursor:pointer}.shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{background:#101828;color:#c9ced8;padding:22px 14px;position:sticky;top:0;height:100vh}.side-brand{padding:5px 10px 25px;color:#fff}.side-brand .logo{width:34px;height:34px}.nav{display:grid;gap:5px}.nav button{background:transparent;border:0;color:#aeb6c5;text-align:left;padding:11px 13px;border-radius:11px;font-weight:700;display:flex;align-items:center;gap:10px}.nav button:hover,.nav button.active{background:#20283a;color:#fff}.side-bottom{position:absolute;bottom:20px;left:14px;right:14px}.user-mini{padding:13px;background:#181f2e;border-radius:13px;font-size:13px}.main{min-width:0}.topbar{height:74px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 30px;position:sticky;top:0;z-index:5}.top-title{font-weight:800;font-size:17px}.content{max-width:1280px;margin:auto;padding:30px}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:25px}.page-head h1{margin:0;font-size:32px;letter-spacing:-.045em}.page-head p{margin:7px 0 0;color:var(--muted)}.grid{display:grid;gap:18px}.stats{grid-template-columns:repeat(4,minmax(0,1fr))}.stat{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 5px 24px rgba(16,24,40,.035)}.stat-label{color:var(--muted);font-size:13px;font-weight:700}.stat-value{font-size:30px;font-weight:850;letter-spacing:-.04em;margin-top:8px}.stat-note{font-size:12px;color:var(--muted);margin-top:6px}.two{grid-template-columns:1.35fr .65fr}.three{grid-template-columns:repeat(3,1fr)}.panel{background:#fff;border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:0 5px 24px rgba(16,24,40,.035)}.panel h3{margin:0 0 5px;font-size:17px}.panel-sub{font-size:13px;color:var(--muted);margin-bottom:18px}.assistant-box{display:flex;flex-direction:column;height:520px}.chat{flex:1;overflow:auto;padding:4px 2px}.bubble{max-width:88%;padding:13px 15px;border-radius:15px;margin:9px 0;line-height:1.55;font-size:14px;white-space:pre-wrap}.bubble.user{margin-left:auto;background:#edeaff;color:#342f70;border-bottom-right-radius:5px}.bubble.ai{background:#f2f4f7;border-bottom-left-radius:5px}.composer{display:flex;gap:8px;border-top:1px solid var(--line);padding-top:14px}.composer textarea{flex:1;resize:none;min-height:48px;max-height:120px;border:1px solid #d0d5dd;border-radius:13px;padding:12px}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:14px}.table th,.table td{padding:13px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}.table th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800}.green{background:#ecfdf3;color:#067647}.orange{background:#fff6ed;color:#b54708}.gray{background:#f2f4f7;color:#475467}.empty{text-align:center;padding:42px 18px;color:var(--muted)}.empty strong{display:block;color:var(--ink);font-size:16px;margin-bottom:6px}.product-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.product{border:1px solid var(--line);border-radius:17px;padding:17px;background:#fff}.product-top{display:flex;justify-content:space-between;gap:10px}.product h4{margin:0;font-size:16px}.price{font-weight:850;font-size:19px;margin-top:15px}.low{color:var(--warning);font-size:12px;font-weight:700}.onboarding{max-width:760px;margin:50px auto}.onboarding .panel{padding:32px}.steps{display:flex;gap:8px;margin-bottom:22px}.step{height:5px;flex:1;background:#eaecf0;border-radius:99px}.step.done{background:var(--brand)}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.toast{position:fixed;right:22px;bottom:22px;background:#101828;color:#fff;padding:13px 16px;border-radius:13px;box-shadow:var(--shadow);z-index:20}.mobile-menu{display:none}.preview{border:1px solid var(--line);border-radius:22px;overflow:hidden;background:#fff}.preview-hero{padding:45px 28px;background:linear-gradient(135deg,#101828,#36307a);color:#fff}.preview-hero h2{font-size:34px;margin:0 0 8px}.preview-body{padding:24px}.quick{display:flex;gap:10px;flex-wrap:wrap}.quick button{width:auto}.check{display:flex;gap:10px;align-items:flex-start}.check-dot{width:24px;height:24px;border-radius:50%;background:#edeaff;color:#635bff;display:grid;place-items:center;font-weight:900;flex:0 0 auto}@media(max-width:1000px){.stats{grid-template-columns:repeat(2,1fr)}.product-grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}}@media(max-width:760px){.login{grid-template-columns:1fr}.login-hero{display:none}.shell{grid-template-columns:1fr}.sidebar{position:fixed;left:0;right:0;bottom:0;top:auto;height:auto;padding:7px 8px;z-index:10;border-top:1px solid #252d3d}.side-brand,.side-bottom{display:none}.nav{display:flex;justify-content:space-around}.nav button{font-size:10px;display:grid;justify-items:center;gap:3px;padding:8px 9px}.nav button span:last-child{display:block}.mobile-menu{display:block}.topbar{padding:0 16px}.content{padding:20px 14px 90px}.page-head{align-items:flex-start}.page-head h1{font-size:27px}.form-grid,.three,.product-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.auth-card{padding:26px}.composer{align-items:flex-end}.composer button{width:52px;font-size:0}.composer button:after{content:"➤";font-size:15px}}
</style>
</head>
<body>
<div id="root"></div>
<div id="toast" class="toast hidden"></div>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
const SUPA_URL="https://mpskusndhblcxzcikzey.supabase.co";
const SUPA_KEY="sb_publishable_W-5z7pwEpUFAKS6YY__l0A_OXi1cBGU";
const supabaseClient=supabase.createClient(SUPA_URL,SUPA_KEY);
const root=document.getElementById("root");
const toastEl=document.getElementById("toast");
let state={business:null,products:[],sales:[],customers:[],summary:null,page:"dashboard"};

function esc(v){return String(v??"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]})}
function money(v){return Number(v||0).toLocaleString("fr-FR")+" FCFA"}
function toast(m){toastEl.textContent=m;toastEl.classList.remove("hidden");setTimeout(function(){toastEl.classList.add("hidden")},2800)}
async function session(){return (await supabaseClient.auth.getSession()).data.session}
async function call(path,opts){
  opts=opts||{};
  const s=await session();
  if(!s) throw Error("Connexion requise.");
  const headers=Object.assign({"Content-Type":"application/json","Authorization":"Bearer "+s.access_token},opts.headers||{});
  const r=await fetch(path,Object.assign({},opts,{headers:headers}));
  const d=await r.json().catch(function(){return {}}); if(!r.ok) throw Error(d.error||"Erreur");
  return d;
}

function loginView(){
root.innerHTML='<div class="login"><div class="login-hero"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="hero-copy"><div class="pill">✦ Votre copilote commercial intelligent</div><h1>Transformez votre ambition en résultats.</h1><p>Comprenez votre activité, prenez de meilleures décisions, créez vos outils commerciaux et avancez chaque jour avec un assistant qui connaît votre entreprise.</p><div style="margin-top:35px;display:grid;gap:13px"><div class="check"><div class="check-dot">✓</div><div><b>Une vision claire</b><br><span style="color:#cbd0df">Votre activité au même endroit.</span></div></div><div class="check"><div class="check-dot">✓</div><div><b>Des actions concrètes</b><br><span style="color:#cbd0df">Pas seulement des conseils.</span></div></div><div class="check"><div class="check-dot">✓</div><div><b>Une IA orientée résultats</b><br><span style="color:#cbd0df">Simple, utile et progressive.</span></div></div></div></div></div><div class="login-box"><div class="auth-card"><div class="brand" style="color:#101828;margin-bottom:30px"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div id="loginForm"><h2>Bienvenue</h2><p class="muted">Connectez-vous à votre espace.</p><div class="field"><label>Email</label><input id="email" type="email" placeholder="vous@exemple.com"></div><div class="field"><label>Mot de passe</label><input id="password" type="password" placeholder="••••••••"></div><button class="btn btn-primary full" id="loginBtn">Se connecter</button><p class="switch">Pas encore de compte ? <span class="link" id="showSignup">Créer mon compte</span></p><p id="authMsg" class="muted" style="font-size:13px"></p></div><div id="signupForm" class="hidden"><h2>Créer votre compte</h2><p class="muted">Commencez gratuitement.</p><div class="field"><label>Email</label><input id="newEmail" type="email" placeholder="vous@exemple.com"></div><div class="field"><label>Mot de passe</label><input id="newPassword" type="password" placeholder="6 caractères minimum"></div><button class="btn btn-primary full" id="signupBtn">Créer mon compte</button><p class="switch">Déjà inscrit ? <span class="link" id="showLogin">Se connecter</span></p><p id="signupMsg" class="muted" style="font-size:13px"></p></div></div></div></div>';
document.getElementById("loginBtn").onclick=doLogin;
document.getElementById("signupBtn").onclick=doSignup;
document.getElementById("showSignup").onclick=function(){document.getElementById("loginForm").classList.add("hidden");document.getElementById("signupForm").classList.remove("hidden")};
document.getElementById("showLogin").onclick=function(){document.getElementById("signupForm").classList.add("hidden");document.getElementById("loginForm").classList.remove("hidden")};
}
async function doLogin(){try{const r=await supabaseClient.auth.signInWithPassword({email:document.getElementById("email").value,password:document.getElementById("password").value});if(r.error)throw r.error;await boot()}catch(e){document.getElementById("authMsg").textContent=e.message}}
async function doSignup(){try{const r=await supabaseClient.auth.signUp({email:document.getElementById("newEmail").value,password:document.getElementById("newPassword").value});if(r.error)throw r.error;document.getElementById("signupMsg").textContent="Compte créé. Vérifiez votre email si une confirmation est demandée."}catch(e){document.getElementById("signupMsg").textContent=e.message}}

function shell(){
root.innerHTML='<div class="shell"><aside class="sidebar"><div class="side-brand"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div></div><nav class="nav" id="nav"><button data-page="dashboard">⌂ <span>Vue d’ensemble</span></button><button data-page="activity">◈ <span>Mon activité</span></button><button data-page="products">▣ <span>Produits & services</span></button><button data-page="sales">↗ <span>Ventes</span></button><button data-page="customers">◎ <span>Clients</span></button><button data-page="assistant">✦ <span>Assistant Pro</span></button><button data-page="preview">◉ <span>Ma page</span></button><button data-page="settings">⚙ <span>Réglages</span></button></nav><div class="side-bottom"><div class="user-mini"><b id="sideBusiness">Mon activité</b><br><span id="sideEmail" style="color:#7f8a9e"></span></div></div></aside><main class="main"><header class="topbar"><div class="top-title" id="topTitle">Vue d’ensemble</div><div style="display:flex;gap:9px;align-items:center"><button class="btn btn-soft mobile-menu" id="quickAssistant">✦ Assistant</button><button class="btn btn-secondary" id="logout">Déconnexion</button></div></header><div class="content" id="content"></div></main></div>';
document.querySelectorAll("#nav button").forEach(function(b){b.onclick=function(){state.page=b.dataset.page;renderPage()}});
document.getElementById("logout").onclick=async function(){await supabaseClient.auth.signOut();loginView()};
document.getElementById("quickAssistant").onclick=function(){state.page="assistant";renderPage()};
}

function onboarding(){
root.innerHTML='<div class="login-box" style="min-height:100vh;background:#f6f7fb"><div class="onboarding"><div class="brand" style="margin-bottom:22px"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="panel"><div class="steps"><div class="step done"></div><div class="step"></div><div class="step"></div></div><h1 style="font-size:34px;letter-spacing:-.05em;margin:0">Commençons par votre activité</h1><p class="muted">Ces informations permettent à votre assistant de comprendre votre contexte.</p><div class="form-grid" style="margin-top:24px"><div class="field"><label>Nom de l’activité *</label><input id="bName" placeholder="Ex. Chez David"></div><div class="field"><label>Type d’activité</label><input id="bType" placeholder="Restaurant, boutique, service..."></div><div class="field"><label>Ville</label><input id="bCity" placeholder="Cotonou, Abomey-Calavi..."></div><div class="field"><label>Téléphone / WhatsApp</label><input id="bPhone" placeholder="+229 ..."></div></div><div class="field"><label>Que proposez-vous ?</label><textarea id="bDesc" rows="4" placeholder="Décrivez simplement vos produits ou services."></textarea></div><div class="field"><label>Votre objectif principal</label><textarea id="bObj" rows="3" placeholder="Ex. Trouver plus de clients et augmenter mes ventes."></textarea></div><button class="btn btn-primary full" id="createBusiness">Créer mon espace professionnel →</button></div></div></div>';
document.getElementById("createBusiness").onclick=async function(){const name=document.getElementById("bName").value.trim();if(!name)return toast("Le nom de votre activité est obligatoire.");try{await call("/api/business",{method:"POST",body:JSON.stringify({name:name,type:document.getElementById("bType").value,city:document.getElementById("bCity").value,phone:document.getElementById("bPhone").value,description:document.getElementById("bDesc").value,objective:document.getElementById("bObj").value})});await boot()}catch(e){toast(e.message)}};
}

async function loadData(){
const results=await Promise.all([call("/api/products"),call("/api/sales"),call("/api/customers"),call("/api/summary")]);
state.products=results[0].products||[];state.sales=results[1].sales||[];state.customers=results[2].customers||[];state.summary=results[3].summary;
}
async function boot(){
const s=await session();if(!s)return loginView();
const me=await call("/api/me");state.business=me.business;
if(!state.business)return onboarding();
await loadData();shell();renderPage();
}

function setActive(){document.querySelectorAll("#nav button").forEach(function(b){b.classList.toggle("active",b.dataset.page===state.page)})}
function renderPage(){
setActive();const b=state.business||{};const titles={dashboard:"Vue d’ensemble",activity:"Mon activité",products:"Produits & services",sales:"Ventes",customers:"Clients",assistant:"Assistant Pro",preview:"Ma page commerciale",settings:"Réglages"};
document.getElementById("topTitle").textContent=titles[state.page]||"Mon Assistant Pro";document.getElementById("sideBusiness").textContent=b.name||"Mon activité";
session().then(function(s){document.getElementById("sideEmail").textContent=s?s.user.email:""});
const views={dashboard:dashboardView,activity:activityView,products:productsView,sales:salesView,customers:customersView,assistant:assistantView,preview:previewView,settings:settingsView};
document.getElementById("content").innerHTML=views[state.page]();bindPage();
}

function head(title,sub,action){return '<div class="page-head"><div><h1>'+title+'</h1><p>'+sub+'</p></div>'+(action||"")+'</div>'}
function dashboardView(){
const s=state.summary||{total:0,salesCount:0,average:0,productsCount:state.products.length,lowStock:0};const b=state.business||{};
return head("Bonjour, "+esc((b.name||"").split(" ")[0])+" 👋","Voici ce qui se passe dans votre activité aujourd’hui.","<button class='btn btn-primary' data-go='assistant'>✦ Que dois-je faire maintenant ?</button>")+
'<div class="grid stats"><div class="stat"><div class="stat-label">Ventes aujourd’hui</div><div class="stat-value">'+money(s.total)+'</div><div class="stat-note">'+s.salesCount+' transaction(s)</div></div><div class="stat"><div class="stat-label">Panier moyen</div><div class="stat-value">'+money(s.average)+'</div><div class="stat-note">Sur les ventes du jour</div></div><div class="stat"><div class="stat-label">Produits / services</div><div class="stat-value">'+s.productsCount+'</div><div class="stat-note">'+s.lowStock+' stock(s) faible(s)</div></div><div class="stat"><div class="stat-label">Clients</div><div class="stat-value">'+state.customers.length+'</div><div class="stat-note">Dans votre carnet</div></div></div>'+
'<div class="grid two" style="margin-top:18px"><div class="panel"><h3>Votre activité</h3><div class="panel-sub">Le contexte que votre Assistant Pro utilise pour vous aider.</div><div style="display:grid;gap:12px"><div><span class="muted">Activité</span><br><b>'+esc(b.name||"—")+'</b></div><div><span class="muted">Domaine</span><br><b>'+esc(b.type||"—")+'</b></div><div><span class="muted">Objectif</span><br><b>'+esc(b.objective||"Ajoutez votre objectif dans Mon activité.")+'</b></div></div></div><div class="panel"><h3>À surveiller</h3><div class="panel-sub">Petites actions qui peuvent faire une vraie différence.</div><div class="check" style="margin:12px 0"><div class="check-dot">✓</div><div><b>Votre page commerciale</b><br><span class="muted">Prévisualisez ce que vos clients verront.</span></div></div><div class="check" style="margin:12px 0"><div class="check-dot">+</div><div><b>Votre catalogue</b><br><span class="muted">'+(state.products.length?'Catalogue déjà commencé.':'Ajoutez votre premier produit ou service.')+'</span></div></div><div class="check" style="margin:12px 0"><div class="check-dot">✦</div><div><b>Votre prochaine action</b><br><span class="muted">Demandez à l’Assistant Pro de prioriser.</span></div></div></div></div>';
}

function activityView(){const b=state.business||{};return head("Mon activité","Votre base de travail. Plus elle est précise, plus l’assistant est utile.")+'<div class="panel"><div class="form-grid"><div class="field"><label>Nom</label><input id="editName" value="'+esc(b.name)+'"></div><div class="field"><label>Type</label><input id="editType" value="'+esc(b.type||"")+'"></div><div class="field"><label>Ville</label><input id="editCity" value="'+esc(b.city||"")+'"></div><div class="field"><label>Téléphone / WhatsApp</label><input id="editPhone" value="'+esc(b.phone||"")+'"></div></div><div class="field"><label>Description</label><textarea id="editDesc" rows="4">'+esc(b.description||"")+'</textarea></div><div class="field"><label>Objectif</label><textarea id="editObj" rows="3">'+esc(b.objective||"")+'</textarea></div><div style="display:flex;justify-content:flex-end"><button class="btn btn-primary" id="saveActivity">Enregistrer les informations</button></div></div>'}

function productsView(){
let cards=state.products.map(function(p){return '<div class="product"><div class="product-top"><div><h4>'+esc(p.name)+'</h4><div class="muted" style="font-size:12px">'+esc(p.category||"Produit / service")+'</div></div><span class="badge '+(p.available?'green':'gray')+'">'+(p.available?'Disponible':'Indisponible')+'</span></div><div class="price">'+money(p.price)+'</div><div style="display:flex;justify-content:space-between;margin-top:10px"><span class="'+(Number(p.stock)<=5?'low':'muted')+'">Stock : '+Number(p.stock||0)+'</span></div></div>'}).join("");
if(!cards)cards='<div class="empty" style="grid-column:1/-1"><strong>Votre catalogue est encore vide</strong>Ajoutez votre premier produit ou service pour commencer.</div>';
return head("Produits & services","Votre catalogue, vos prix et votre stock.","<button class='btn btn-primary' data-open='product'>+ Ajouter</button>")+'<div class="grid product-grid">'+cards+'</div><div id="productModal" class="hidden"></div>';
}

function salesView(){
let rows=state.sales.map(function(s){return '<tr><td>'+new Date(s.created_at).toLocaleString("fr-FR")+'</td><td><b>'+money(s.total)+'</b></td><td><span class="badge gray">'+esc(s.payment_method||"cash")+'</span></td><td>Vente enregistrée</td></tr>'}).join("");
if(!rows)rows='<tr><td colspan="4" class="empty">Aucune vente enregistrée pour le moment.</td></tr>';
return head("Ventes","Enregistrez vos ventes et gardez une vision simple de votre activité.","<button class='btn btn-primary' data-open='sale'>+ Nouvelle vente</button>")+'<div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Montant</th><th>Paiement</th><th>État</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

function customersView(){
let rows=state.customers.map(function(c){return '<tr><td><b>'+esc(c.name||"Client")+'</b></td><td>'+esc(c.phone||"—")+'</td><td>'+money(c.total_spent)+'</td><td>'+(c.last_purchase_at?new Date(c.last_purchase_at).toLocaleDateString("fr-FR"):"—")+'</td></tr>'}).join("");
if(!rows)rows='<tr><td colspan="4" class="empty">Votre carnet client se remplira avec vos clients.</td></tr>';
return head("Clients","Un carnet simple pour mieux connaître et relancer vos clients.")+'<div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Client</th><th>Contact</th><th>Total dépensé</th><th>Dernier achat</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
}

function assistantView(){
return head("Votre Assistant Pro","Posez une question. Il connaît votre activité et vous aide à choisir la prochaine meilleure action.")+'<div class="panel assistant-box"><div class="chat" id="chat"><div class="bubble ai"><b>Bonjour 👋</b><br>Je suis votre copilote commercial. Je peux analyser votre activité, vous aider à vendre davantage, trouver une idée d’offre, préparer un message WhatsApp ou vous dire quoi faire maintenant.</div></div><div class="quick" style="margin-bottom:10px"><button class="btn btn-secondary quickAsk" data-q="Que dois-je faire maintenant pour développer mon activité ?">Que faire maintenant ?</button><button class="btn btn-secondary quickAsk" data-q="Analyse mon activité et donne-moi mes 3 priorités.">Mes 3 priorités</button><button class="btn btn-secondary quickAsk" data-q="Comment puis-je vendre davantage cette semaine ?">Vendre plus</button></div><div class="composer"><textarea id="assistantInput" placeholder="Ex. Comment attirer 10 nouveaux clients ?"></textarea><button class="btn btn-primary" id="sendAssistant">Envoyer</button></div></div>';
}

function previewView(){
const b=state.business||{};let products=state.products.slice(0,6).map(function(p){return '<div class="product"><h4>'+esc(p.name)+'</h4><div class="muted" style="font-size:13px;margin-top:4px">'+esc(p.description||"Découvrez ce produit.")+'</div><div class="price">'+money(p.price)+'</div></div>'}).join("");
if(!products)products='<div class="empty">Ajoutez vos produits pour les afficher ici.</div>';
return head("Ma page commerciale","La vitrine que vos futurs clients pourront découvrir.","<button class='btn btn-secondary' id='copyPage'>Copier le lien</button>")+'<div class="preview"><div class="preview-hero"><span class="pill">Disponible avec Mon Assistant Pro</span><h2>'+esc(b.name||"Votre activité")+'</h2><p style="color:#d8dbe8;max-width:600px">'+esc(b.description||"Une activité présentée clairement, avec vos produits et un assistant commercial.")+'</p><div class="quick"><button class="btn" style="background:#fff;color:#302b68">Découvrir</button><button class="btn" style="background:rgba(255,255,255,.12);color:#fff">Parler à l’assistant</button></div></div><div class="preview-body"><h3>Nos produits & services</h3><div class="grid product-grid" style="margin-top:15px">'+products+'</div></div></div>';
}

function settingsView(){return head("Réglages","Les paramètres essentiels de votre espace.")+'<div class="grid three"><div class="panel"><h3>Compte</h3><div class="panel-sub">Connexion et sécurité.</div><span class="badge green">Compte actif</span></div><div class="panel"><h3>Assistant IA</h3><div class="panel-sub">Moteur actuellement utilisé.</div><b>Cloudflare Workers AI</b><br><span class="muted">Llama 3.2 3B</span></div><div class="panel"><h3>Plan</h3><div class="panel-sub">Configuration actuelle.</div><b>Essentiel</b><br><span class="muted">Les fonctions avancées pourront évoluer avec votre activité.</span></div></div>'}

function bindPage(){
document.querySelectorAll("[data-go]").forEach(function(x){x.onclick=function(){state.page=x.dataset.go;renderPage()}});
document.querySelectorAll("[data-open]").forEach(function(x){x.onclick=function(){if(x.dataset.open==="product")openProduct();if(x.dataset.open==="sale")openSale()}});
if(document.getElementById("saveActivity"))document.getElementById("saveActivity").onclick=saveActivity;
if(document.getElementById("sendAssistant"))document.getElementById("sendAssistant").onclick=function(){sendAssistant(document.getElementById("assistantInput").value)};
document.querySelectorAll(".quickAsk").forEach(function(x){x.onclick=function(){sendAssistant(x.dataset.q)}});
if(document.getElementById("copyPage"))document.getElementById("copyPage").onclick=function(){navigator.clipboard?.writeText(location.href);toast("Lien de cette page copié.")};
}
async function saveActivity(){try{const b=state.business;const body={name:document.getElementById("editName").value,type:document.getElementById("editType").value,city:document.getElementById("editCity").value,phone:document.getElementById("editPhone").value,description:document.getElementById("editDesc").value,objective:document.getElementById("editObj").value};const r=await call("/api/business",{method:"POST",body:JSON.stringify(body)});state.business=r.business||b;toast("Informations enregistrées.");renderPage()}catch(e){toast(e.message)}}
function modal(title,body){const div=document.createElement("div");div.style.cssText="position:fixed;inset:0;background:rgba(16,24,40,.45);z-index:30;display:grid;place-items:center;padding:18px";div.innerHTML='<div class="panel" style="width:min(520px,100%)"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+title+'</h3><button class="btn btn-secondary" id="closeModal">Fermer</button></div>'+body+'</div>';document.body.appendChild(div);document.getElementById("closeModal").onclick=function(){div.remove()};return div}
function openProduct(){const m=modal("Ajouter un produit ou service",'<div class="field"><label>Nom</label><input id="mName"></div><div class="field"><label>Prix (FCFA)</label><input id="mPrice" type="number"></div><div class="field"><label>Stock</label><input id="mStock" type="number" value="0"></div><div class="field"><label>Description</label><textarea id="mDesc" rows="3"></textarea></div><button class="btn btn-primary full" id="mSave">Ajouter au catalogue</button>');m.querySelector("#mSave").onclick=async function(){try{await call("/api/products",{method:"POST",body:JSON.stringify({name:m.querySelector("#mName").value,price:m.querySelector("#mPrice").value,stock:m.querySelector("#mStock").value,description:m.querySelector("#mDesc").value})});m.remove();await loadData();renderPage();toast("Produit ajouté.");}catch(e){toast(e.message)}}}
function openSale(){const m=modal("Enregistrer une vente",'<div class="field"><label>Montant total (FCFA)</label><input id="sTotal" type="number" placeholder="5000"></div><div class="field"><label>Mode de paiement</label><select id="sPay"><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="other">Autre</option></select></div><button class="btn btn-primary full" id="sSave">Enregistrer la vente</button>');m.querySelector("#sSave").onclick=async function(){try{await call("/api/sales",{method:"POST",body:JSON.stringify({total:m.querySelector("#sTotal").value,payment_method:m.querySelector("#sPay").value})});m.remove();await loadData();state.page="dashboard";renderPage();toast("Vente enregistrée.");}catch(e){toast(e.message)}}}
async function sendAssistant(q){q=String(q||"").trim();if(!q)return;const chat=document.getElementById("chat");if(!chat)return;chat.innerHTML+='<div class="bubble user">'+esc(q)+'</div>';chat.innerHTML+='<div class="bubble ai" id="thinking">Analyse en cours…</div>';chat.scrollTop=chat.scrollHeight;try{const d=await call("/api/assistant",{method:"POST",body:JSON.stringify({message:q})});const t=document.getElementById("thinking");if(t)t.outerHTML='<div class="bubble ai">'+esc(d.answer||"Je n’ai pas pu répondre.")+'</div>'}catch(e){const t=document.getElementById("thinking");if(t)t.outerHTML='<div class="bubble ai">Je rencontre un problème pour répondre. Réessayez dans un instant.</div>'}chat.scrollTop=chat.scrollHeight}

supabaseClient.auth.onAuthStateChange(function(event,s){if(event==="SIGNED_OUT")loginView()});
(async function(){try{await boot()}catch(e){console.error(e);loginView()}})();
</script>
</body></html>`;
