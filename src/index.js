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
  if (!r.ok) { const detail = typeof data === "object" ? (data?.message || data?.error_description || data?.hint || JSON.stringify(data)) : String(data || ""); throw new Error("Supabase (" + r.status + "): " + (detail || "requête refusée")); }
  return data;
}

function tokenFrom(req) {
  const h=req.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

async function currentBusiness(env, token, ownerId) {
  const filter = ownerId ? "&owner_id=eq." + encodeURIComponent(ownerId) : "";
  const rows = await sb(env, "businesses?select=*&order=created_at.asc&limit=1" + filter, {method:"GET"}, token);
  return rows && rows[0] ? rows[0] : null;
}

async function authenticatedUser(env, token) {
  const auth=await fetch(env.SUPABASE_URL+"/auth/v1/user",{headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:"Bearer "+token}});
  const raw=await auth.text(); let data=null; try{data=raw?JSON.parse(raw):null}catch{}
  if(!auth.ok || !data?.id) throw new Error("Session Supabase invalide.");
  return data;
}

async function api(req, env) {
  const token=tokenFrom(req);
  if (!token) return json({error:"Connexion requise."},401);
  const url=new URL(req.url);
  const p=url.pathname;

  try {
    if (p==="/api/me" && req.method==="GET") {
      const u=await authenticatedUser(env,token);
      const b=await currentBusiness(env,token,u.id);
      return json({user:{id:u.id,email:u.email||null},business:b});
    }

    if (p==="/api/business" && (req.method==="POST" || req.method==="PATCH")) {
      const body=await req.json();
      const u=await authenticatedUser(env,token);
      const existing=await currentBusiness(env,token,u.id);
      const payload={
        name:String(body.name||"").trim(),
        type:body.type||null,
        description:body.description||null,
        phone:body.phone||null,
        whatsapp:body.whatsapp||null,
        city:body.city||null,
        address:body.address||null,
        opening_hours:body.opening_hours||null,
        objective:body.objective||null
      };
      if(existing){
        const data=await sb(env,"businesses?id=eq."+existing.id,{
          method:"PATCH",
          headers:{"Prefer":"return=representation"},
          body:JSON.stringify(payload)
        },token);
        return json({business:data?.[0]||existing});
      }
      const data=await sb(env,"businesses",{
        method:"POST",
        headers:{"Prefer":"return=representation"},
        body:JSON.stringify({...payload,owner_id:u.id})
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
    if(url.pathname === "/" || url.pathname === "/index.html"){
      return new Response(HTML,{headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}});
    }
    if(env.ASSETS){
      const asset=await env.ASSETS.fetch(req);
      if(asset.status!==404) return asset;
    }
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
.hidden{display:none!important}.app{min-height:100vh}.login{min-height:100vh;display:grid;grid-template-columns:1.1fr .9fr;background:#fff}.login-hero{padding:7vw;background:linear-gradient(145deg,#111827 0%,#1f2350 55%,#635bff 100%);color:#fff;position:relative;overflow:hidden}.login-hero:after{content:"";position:absolute;width:420px;height:420px;border-radius:50%;right:-170px;bottom:-160px;background:rgba(255,255,255,.08)}.brand{display:flex;align-items:center;gap:10px;font-weight:800;letter-spacing:-.03em}.logo{width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#fff,#c4b5fd);display:grid;place-items:center;color:#4f46e5;font-weight:900}.hero-copy{max-width:620px;margin-top:13vh}.hero-copy h1{font-size:clamp(38px,5vw,72px);line-height:.98;letter-spacing:-.055em;margin:0 0 22px}.hero-copy p{font-size:19px;line-height:1.6;color:#d8dbe8;max-width:540px}.pill{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.1);color:#e7e9f4;font-size:13px;font-weight:700;margin-bottom:18px}.login-box{display:grid;place-items:center;padding:30px}.auth-card{width:min(440px,100%);padding:38px;border:1px solid var(--line);border-radius:28px;box-shadow:var(--shadow);background:#fff}.auth-card h2{font-size:30px;letter-spacing:-.04em;margin:0 0 8px}.muted{color:var(--muted)}.field{margin:14px 0}.field label{display:block;font-size:13px;font-weight:700;margin-bottom:7px}.field input,.field textarea,.field select{width:100%;border:1px solid #d0d5dd;border-radius:13px;padding:13px 14px;outline:none;background:#fff}.field input:focus,.field textarea:focus,.field select:focus{border-color:#8b82ff;box-shadow:0 0 0 4px rgba(99,91,255,.1)}.btn{border:0;border-radius:13px;padding:13px 17px;font-weight:800;transition:.2s}.btn:hover{transform:translateY(-1px)}.btn-primary{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff}.btn-secondary{background:#fff;border:1px solid #d0d5dd;color:var(--ink)}.btn-soft{background:var(--soft);color:#5146b8}.btn-danger{background:#fff1f0;color:var(--danger)}.full{width:100%}.switch{text-align:center;margin-top:18px;font-size:14px}.link{color:#5146b8;font-weight:800;cursor:pointer}.shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{background:#101828;color:#c9ced8;padding:22px 14px;position:sticky;top:0;height:100vh}.side-brand{padding:5px 10px 25px;color:#fff}.side-brand .logo{width:34px;height:34px}.nav{display:grid;gap:5px}.nav button{background:transparent;border:0;color:#aeb6c5;text-align:left;padding:11px 13px;border-radius:11px;font-weight:700;display:flex;align-items:center;gap:10px}.nav button:hover,.nav button.active{background:#20283a;color:#fff}.side-bottom{position:absolute;bottom:20px;left:14px;right:14px}.user-mini{padding:13px;background:#181f2e;border-radius:13px;font-size:13px}.main{min-width:0}.topbar{height:74px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 30px;position:sticky;top:0;z-index:5}.top-title{font-weight:800;font-size:17px}.content{max-width:1280px;margin:auto;padding:30px}.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:25px}.page-head h1{margin:0;font-size:32px;letter-spacing:-.045em}.page-head p{margin:7px 0 0;color:var(--muted)}.grid{display:grid;gap:18px}.stats{grid-template-columns:repeat(4,minmax(0,1fr))}.stat{background:#fff;border:1px solid var(--line);border-radius:18px;padding:20px;box-shadow:0 5px 24px rgba(16,24,40,.035)}.stat-label{color:var(--muted);font-size:13px;font-weight:700}.stat-value{font-size:30px;font-weight:850;letter-spacing:-.04em;margin-top:8px}.stat-note{font-size:12px;color:var(--muted);margin-top:6px}.two{grid-template-columns:1.35fr .65fr}.three{grid-template-columns:repeat(3,1fr)}.panel{background:#fff;border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:0 5px 24px rgba(16,24,40,.035)}.panel h3{margin:0 0 5px;font-size:17px}.panel-sub{font-size:13px;color:var(--muted);margin-bottom:18px}.assistant-box{display:flex;flex-direction:column;height:520px}.chat{flex:1;overflow:auto;padding:4px 2px}.bubble{max-width:88%;padding:13px 15px;border-radius:15px;margin:9px 0;line-height:1.55;font-size:14px;white-space:pre-wrap}.bubble.user{margin-left:auto;background:#edeaff;color:#342f70;border-bottom-right-radius:5px}.bubble.ai{background:#f2f4f7;border-bottom-left-radius:5px}.composer{display:flex;gap:8px;border-top:1px solid var(--line);padding-top:14px}.composer textarea{flex:1;resize:none;min-height:48px;max-height:120px;border:1px solid #d0d5dd;border-radius:13px;padding:12px}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;font-size:14px}.table th,.table td{padding:13px 10px;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}.table th{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.05em}.badge{display:inline-flex;padding:5px 9px;border-radius:999px;font-size:11px;font-weight:800}.green{background:#ecfdf3;color:#067647}.orange{background:#fff6ed;color:#b54708}.gray{background:#f2f4f7;color:#475467}.empty{text-align:center;padding:42px 18px;color:var(--muted)}.empty strong{display:block;color:var(--ink);font-size:16px;margin-bottom:6px}.product-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.product{border:1px solid var(--line);border-radius:17px;padding:17px;background:#fff}.product-top{display:flex;justify-content:space-between;gap:10px}.product h4{margin:0;font-size:16px}.price{font-weight:850;font-size:19px;margin-top:15px}.low{color:var(--warning);font-size:12px;font-weight:700}.onboarding{max-width:760px;margin:50px auto}.onboarding .panel{padding:32px}.steps{display:flex;gap:8px;margin-bottom:22px}.step{height:5px;flex:1;background:#eaecf0;border-radius:99px}.step.done{background:var(--brand)}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.toast{position:fixed;right:22px;bottom:22px;background:#101828;color:#fff;padding:13px 16px;border-radius:13px;box-shadow:var(--shadow);z-index:20}.mobile-menu{display:none}.landing{background:#fff;min-height:100vh}.landing-nav{height:76px;display:flex;align-items:center;justify-content:space-between;gap:25px;padding:0 5vw;border-bottom:1px solid rgba(234,236,240,.8);position:sticky;top:0;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);z-index:20}.landing-links{display:flex;gap:28px;font-size:14px;font-weight:700}.landing-links a{color:#475467;text-decoration:none}.landing-actions{display:flex;gap:9px}.landing-hero{min-height:680px;padding:90px 7vw 80px;display:grid;grid-template-columns:1.05fr .95fr;gap:60px;align-items:center;background:radial-gradient(circle at 85% 15%,#ece9ff 0,transparent 33%),linear-gradient(180deg,#fff 0,#f8f7ff 100%)}.hero-left h1{font-size:clamp(44px,6vw,76px);line-height:.98;letter-spacing:-.065em;max-width:760px;margin:0 0 24px}.hero-left h1 span{color:#635bff}.hero-left>p{font-size:20px;line-height:1.65;color:#667085;max-width:650px}.dark-pill{background:#efedff;color:#5146b8}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}.btn-lg{padding:15px 20px;font-size:15px}.trust-row{display:flex;gap:18px;flex-wrap:wrap;margin-top:22px;color:#667085;font-size:13px;font-weight:700}.hero-card{display:flex;justify-content:center}.hero-image{width:min(500px,100%);aspect-ratio:1/1;object-fit:cover;border-radius:30px;box-shadow:0 35px 90px rgba(31,35,80,.22);display:block}.feature-card{overflow:hidden}.feature-image{width:100%;height:190px;object-fit:cover;border-radius:16px;margin-bottom:6px;display:block}.mini-window{width:min(500px,100%);background:#111827;border-radius:28px;padding:18px;box-shadow:0 35px 90px rgba(31,35,80,.25);transform:rotate(1deg)}.mini-top{display:flex;justify-content:space-between;color:#fff;font-size:13px;font-weight:800;padding:3px 5px 17px}.live-dot{color:#65d89a;font-size:11px}.mini-kpi{background:#1f2937;border-radius:18px;padding:17px;color:#fff}.mini-kpi small{display:block;color:#98a2b3}.mini-kpi b{display:block;font-size:28px;margin:5px 0 12px}.mini-progress{height:8px;background:#374151;border-radius:99px;overflow:hidden}.mini-progress span{display:block;width:72%;height:100%;background:linear-gradient(90deg,#8b5cf6,#6366f1);border-radius:99px}.mini-chat{padding:14px 3px 2px}.mini-msg{max-width:85%;padding:11px 13px;border-radius:13px;margin:8px 0;font-size:12px;line-height:1.5;color:#dbe2ea}.mini-msg.ai{background:#1f2937}.mini-msg.strong{color:#fff}.mini-msg.user{margin-left:auto;background:#635bff;color:#fff}.landing-section{padding:100px 7vw}.section-intro{text-align:center;max-width:780px;margin:0 auto 45px}.eyebrow{font-size:11px;letter-spacing:.16em;font-weight:900;color:#635bff}.section-intro h2,.benefit-copy h2{font-size:clamp(34px,4vw,52px);line-height:1.04;letter-spacing:-.055em;margin:13px 0}.section-intro p{font-size:17px;color:#667085;line-height:1.6}.feature-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;max-width:1250px;margin:auto}.feature-card{border:1px solid #eaecf0;border-radius:22px;padding:24px;background:#fff;box-shadow:0 10px 35px rgba(16,24,40,.045)}.feature-icon{width:44px;height:44px;border-radius:13px;background:#efedff;color:#635bff;display:grid;place-items:center;font-weight:900;font-size:20px}.feature-card h3{font-size:19px;margin:20px 0 8px}.feature-card p{color:#667085;line-height:1.55;min-height:75px}.feature-card small{color:#5146b8;font-weight:800}.benefits-section{padding:100px 7vw;background:#101828;color:#fff;display:grid;grid-template-columns:1fr 1fr;gap:70px;align-items:center}.benefit-copy h2{max-width:600px}.benefit-list{display:grid;gap:10px;margin-top:35px}.benefit-item{display:grid;grid-template-columns:45px 1fr;gap:15px;padding:20px 0;border-bottom:1px solid rgba(255,255,255,.1)}.benefit-item>span{color:#9b8cff;font-weight:900}.benefit-item h3{margin:0 0 6px}.benefit-item p{margin:0;color:#aeb6c5;line-height:1.5}.benefit-panel{background:linear-gradient(145deg,#1d2432,#302b68);border:1px solid rgba(255,255,255,.1);border-radius:30px;padding:42px;box-shadow:0 30px 80px rgba(0,0,0,.2)}.quote-mark{font-size:72px;line-height:.5;color:#9b8cff}.benefit-panel h3{font-size:31px;line-height:1.15;letter-spacing:-.04em;margin:20px 0}.benefit-panel p{color:#cbd0df;line-height:1.6}.result-line{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:30px;font-weight:800}.result-line span{background:rgba(255,255,255,.08);padding:9px 11px;border-radius:10px}.plans{background:#f8f9fc}.plan-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;max-width:1100px;margin:auto}.plan{background:#fff;border:1px solid #eaecf0;border-radius:25px;padding:28px;position:relative;box-shadow:0 12px 40px rgba(16,24,40,.05)}.plan.featured{border:2px solid #635bff;transform:translateY(-10px);box-shadow:0 25px 60px rgba(99,91,255,.16)}.popular{position:absolute;right:18px;top:18px;background:#635bff;color:#fff;padding:6px 9px;border-radius:999px;font-size:9px;font-weight:900}.plan h3{font-size:22px;margin:0 0 20px}.plan-price{font-size:35px;font-weight:900;letter-spacing:-.05em}.plan-price small{font-size:12px;color:#667085;font-weight:700}.plan-for{color:#667085;font-size:13px;margin-top:3px}.plan-features{line-height:2.05;color:#475467;min-height:175px;margin:18px 0}.plans-note{text-align:center;color:#98a2b3;font-size:12px;margin-top:25px}.final-cta{margin:0 5vw 50px;padding:65px 7vw;border-radius:32px;background:linear-gradient(120deg,#1d2350,#635bff);color:#fff;display:flex;justify-content:space-between;align-items:center;gap:30px}.final-cta h2{font-size:clamp(32px,4vw,52px);letter-spacing:-.055em;margin:10px 0}.final-cta p{color:#d8dbe8}.light{color:#c4b5fd}.btn-white{background:#fff;color:#37306e}.landing-footer{padding:25px 7vw 40px;display:flex;justify-content:space-between;gap:20px;color:#98a2b3;font-size:12px}.auth-page{min-height:100vh;display:grid;grid-template-columns:1fr 1fr;background:#fff}.auth-side{padding:55px 7vw;background:linear-gradient(145deg,#101828,#282356 70%,#635bff);color:#fff;display:flex;flex-direction:column}.auth-side-copy{max-width:560px;margin:auto 0}.auth-side-copy h1{font-size:clamp(42px,5vw,66px);line-height:1;letter-spacing:-.06em;margin:14px 0 22px}.auth-side-copy p{font-size:18px;line-height:1.6;color:#d8dbe8}.auth-benefits{display:grid;gap:12px;margin-top:30px;color:#e7e9f4;font-weight:700}.auth-main{display:grid;place-items:center;padding:30px}.auth-modern{width:min(450px,100%);border:0;box-shadow:none;padding:30px}.back-link{border:0;background:none;color:#667085;font-weight:700;padding:0;margin-bottom:40px}.auth-icon{width:52px;height:52px;border-radius:16px;background:#efedff;color:#635bff;display:grid;place-items:center;font-weight:900;margin-bottom:18px}.auth-modern h2{font-size:34px}.phone-field{display:grid;grid-template-columns:130px 1fr;gap:8px;margin:22px 0 12px}.phone-field select,.phone-field input{border:1px solid #d0d5dd;border-radius:13px;padding:14px;outline:none;background:#fff}.auth-msg{min-height:20px;margin-top:10px;color:#d92d20;font-size:13px}.auth-switch{text-align:center;font-size:13px;color:#667085;margin-top:18px}.otp-label{font-size:13px;font-weight:800;margin:25px 0 8px}.otp-input{text-align:center;letter-spacing:.4em;font-size:28px;font-weight:900;width:100%;border:1px solid #d0d5dd;border-radius:14px;padding:14px}.security-note{margin-top:25px;padding:13px;border-radius:12px;background:#f8f9fc;color:#667085;font-size:12px;line-height:1.5}
.preview{border:1px solid var(--line);border-radius:22px;overflow:hidden;background:#fff}.preview-hero{padding:45px 28px;background:linear-gradient(135deg,#101828,#36307a);color:#fff}.preview-hero h2{font-size:34px;margin:0 0 8px}.preview-body{padding:24px}.quick{display:flex;gap:10px;flex-wrap:wrap}.quick button{width:auto}.check{display:flex;gap:10px;align-items:flex-start}.check-dot{width:24px;height:24px;border-radius:50%;background:#edeaff;color:#635bff;display:grid;place-items:center;font-weight:900;flex:0 0 auto}@media(max-width:1000px){.feature-grid{grid-template-columns:repeat(2,1fr)}.plan-grid{grid-template-columns:1fr}.plan.featured{transform:none}.landing-hero{grid-template-columns:1fr}.benefits-section{grid-template-columns:1fr}.landing-links{display:none}.landing-nav{padding:0 20px}.landing-actions .btn-secondary{display:none}.final-cta{margin:0 14px 35px;padding:45px 28px;display:block}.final-cta .btn{margin-top:20px}.landing-footer{padding:25px 20px;display:block}.landing-footer .brand{margin-bottom:10px}.auth-page{grid-template-columns:1fr}.auth-side{display:none}.stats{grid-template-columns:repeat(2,1fr)}.product-grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}}@media(max-width:760px){.landing-nav{height:66px}.landing-hero{padding:65px 20px}.hero-left h1{font-size:46px}.hero-left>p{font-size:17px}.hero-actions .btn{width:100%}.feature-grid{grid-template-columns:1fr}.landing-section{padding:70px 20px}.benefits-section{padding:70px 20px}.benefit-panel{padding:28px}.result-line{font-size:12px}.phone-field{grid-template-columns:112px 1fr}.auth-main{padding:20px}.auth-modern{padding:10px}.plan-price{font-size:30px}.login{grid-template-columns:1fr}.login-hero{display:none}.shell{grid-template-columns:1fr}.sidebar{position:fixed;left:0;right:0;bottom:0;top:auto;height:auto;padding:7px 8px;z-index:10;border-top:1px solid #252d3d}.side-brand,.side-bottom{display:none}.nav{display:flex;justify-content:space-around}.nav button{font-size:10px;display:grid;justify-items:center;gap:3px;padding:8px 9px}.nav button span:last-child{display:block}.mobile-menu{display:block}.topbar{padding:0 16px}.content{padding:20px 14px 90px}.page-head{align-items:flex-start}.page-head h1{font-size:27px}.form-grid,.three,.product-grid{grid-template-columns:1fr}.stats{grid-template-columns:1fr 1fr}.auth-card{padding:26px}.composer{align-items:flex-end}.composer button{width:52px;font-size:0}.composer button:after{content:"➤";font-size:15px}}
</style>
</head>
<body>
<div id="root"></div>
<div id="toast" class="toast hidden"></div>
<script>
const SUPA_URL="https://mpskusndhblcxzcikzey.supabase.co";
const SUPA_KEY="sb_publishable_W-5z7pwEpUFAKS6YY__l0A_OXi1cBGU";
let supabaseClient=null;
const root=document.getElementById("root");
const toastEl=document.getElementById("toast");
let state={user:null,business:null,products:[],sales:[],customers:[],summary:null,page:"dashboard"};

function esc(v){return String(v??"").replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]})}
function money(v){return Number(v||0).toLocaleString("fr-FR")+" FCFA"}
function toast(m){toastEl.textContent=m;toastEl.classList.remove("hidden");setTimeout(function(){toastEl.classList.add("hidden")},2800)}
async function session(){if(!supabaseClient)return null;return (await supabaseClient.auth.getSession()).data.session}
async function call(path,opts){
  opts=opts||{};
  const s=await session();
  if(!s) throw Error("Connexion requise.");
  const headers=Object.assign({"Content-Type":"application/json","Authorization":"Bearer "+s.access_token},opts.headers||{});
  const r=await fetch(path,Object.assign({},opts,{headers:headers}));
  const d=await r.json().catch(function(){return {}}); if(!r.ok){const detail=d&&(d.error||d.message||d.error_description);throw Error(detail||("Erreur HTTP "+r.status));}
  return d;
}

function openAuth(mode,screen){
  try{
    authView(mode,screen);
  }catch(e){
    toast(e.message||"Impossible d’ouvrir la connexion. Réessayez dans un instant.");
  }
}

function landingView(){
root.innerHTML='<div class="landing">'+
'<header class="landing-nav"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="landing-links"><a href="#solution">Ce que je peux faire</a><a href="#benefits">Avantages</a><a href="#plans">Formules</a></div><div class="landing-actions"><button class="btn btn-secondary" id="goLogin">Se connecter</button><button class="btn btn-primary" id="goSignup">Créer mon espace</button></div></header>'+
'<main>'+
'<section class="landing-hero"><div class="hero-left"><div class="pill dark-pill">✦ L’assistant commercial pensé pour les petites activités</div><h1>Votre activité mérite un assistant qui <span>travaille avec vous.</span></h1><p>Mon Assistant Pro vous aide à comprendre votre activité, attirer des clients, vendre, organiser vos informations et décider quoi faire ensuite — même si vous débutez.</p><div class="hero-actions"><button class="btn btn-primary btn-lg" id="heroSignup">Commencer gratuitement →</button><button class="btn btn-secondary btn-lg" id="heroDiscover">Découvrir comment ça marche</button></div><div class="trust-row"><span>✓ Email + mot de passe simple</span><span>✓ Simple à utiliser</span><span>✓ Pensé pour le terrain</span></div></div><div class="hero-card"><div class="mini-window"><div class="mini-top"><span>Mon Assistant Pro</span><span class="live-dot">● En ligne</span></div><div class="mini-kpi"><div><small>Objectif du jour</small><b>23 500 FCFA</b></div><div class="mini-progress"><span></span></div></div><div class="mini-chat"><div class="mini-msg ai">Bonjour 👋 Voici ce que je vous conseille aujourd’hui.</div><div class="mini-msg ai strong">1. Relancez vos 4 clients inactifs<br>2. Mettez votre meilleure offre en avant<br>3. Ajoutez votre nouveau produit</div><div class="mini-msg user">Prépare-moi le message WhatsApp.</div><div class="mini-msg ai">Bien sûr. Je prépare un message prêt à envoyer.</div></div></div></div></section>'+
'<section id="solution" class="landing-section"><div class="section-intro"><span class="eyebrow">UN SEUL ESPACE</span><h2>Tout ce dont vous avez besoin pour avancer.</h2><p>Vous n’avez pas besoin de maîtriser la technologie. Vous expliquez votre activité, Mon Assistant Pro vous aide à transformer cela en actions.</p></div><div class="feature-grid">'+
feature("✦","Comprendre","Décrivez votre activité, vos produits, vos clients et vos objectifs. Votre assistant garde le contexte.","Votre activité devient claire et exploitable.","/images/photographe-vitrine.webp","Vitrine professionnelle")+
feature("◎","Décider","Demandez quoi faire, quoi améliorer, comment vendre davantage ou comment résoudre un problème.","Des priorités plutôt que des conseils dispersés.","/images/assistant-smartphone.webp","Assistant commercial sur smartphone")+
feature("▣","Vendre","Présentez vos produits ou services dans une page professionnelle et préparez vos messages commerciaux.","Une présence commerciale simple et crédible.","/images/comptoir-boutique.webp","Commerce et vente en boutique")+
feature("↗","Suivre","Enregistrez vos ventes, vos clients et vos indicateurs essentiels.","Vous savez ce qui se passe réellement.","/images/page-contact.webp","Page commerciale et contact client")+
'</div></section>'+
'<section id="benefits" class="benefits-section"><div class="benefit-copy"><span class="eyebrow">PENSÉ POUR LE TERRAIN</span><h2>Simple pour vous. Puissant quand votre activité grandit.</h2><div class="benefit-list">'+
benefit("01","Vous partez de zéro","Vous avez seulement une idée ? L’assistant peut vous aider à structurer le projet et choisir les premières étapes.")+
benefit("02","Vous avez déjà une activité","Ajoutez vos informations, produits et ventes. L’assistant s’appuie sur votre réalité, pas sur des suppositions.")+
benefit("03","Vous voulez vendre plus","Obtenez des idées d’offres, des arguments, des messages et des actions prioritaires.")+
benefit("04","Vous voulez garder le contrôle","L’assistant prépare et recommande. Vous gardez la décision finale avant toute action sensible.")+
'</div></div><div class="benefit-panel"><div class="quote-mark">“</div><h3>Une personne + une ambition → un résultat concret.</h3><p>Mon Assistant Pro est conçu pour faire passer votre activité de l’idée à l’action, puis de l’action à l’amélioration.</p><div class="result-line"><span>Idée</span><b>→</b><span>Action</span><b>→</b><span>Résultat</span><b>→</b><span>Amélioration</span></div></div></section>'+
'<section id="plans" class="landing-section plans"><div class="section-intro"><span class="eyebrow">FORMULES</span><h2>Commencez petit. Évoluez quand votre activité évolue.</h2><p>Les formules sont conçues pour ne pas vous faire payer des fonctions inutiles au départ.</p></div><div class="plan-grid">'+
plan("Essentiel","0 FCFA","Pour démarrer","✓ Espace professionnel<br>✓ Produits & services<br>✓ Page commerciale<br>✓ Assistant Pro limité<br>✓ Suivi de base","Créer mon espace",false)+
plan("Pro","3 500 FCFA","par mois","✓ Tout Essentiel<br>✓ Assistant commercial renforcé<br>✓ Conseils & stratégies<br>✓ Contenus et messages commerciaux<br>✓ Suivi des ventes et clients<br>✓ Recommandations d’actions","Choisir Pro",true)+
plan("Pro+","10 000 FCFA","par mois","✓ Tout Pro<br>✓ Analyses avancées<br>✓ Recommandations proactives<br>✓ Campagnes commerciales<br>✓ Automatisations supplémentaires<br>✓ Priorité sur les nouvelles fonctions","Choisir Pro+",false)+
'</div><p class="plans-note">Les tarifs pourront évoluer avec le produit. Aucun paiement automatique n’est activé tant que le système de paiement n’est pas connecté.</p></section>'+
'<section class="final-cta"><div><span class="eyebrow light">PRÊT À COMMENCER ?</span><h2>Votre activité. Votre ambition. Votre assistant.</h2><p>Créez votre espace en quelques secondes avec votre adresse email.</p></div><button class="btn btn-white btn-lg" id="finalSignup">Créer mon espace gratuitement →</button></section>'+
'</main><footer class="landing-footer"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div><span>© 2026 — Votre copilote commercial intelligent.</span></footer></div>';
document.getElementById("goLogin").onclick=()=>openAuth("login");
document.getElementById("goSignup").onclick=()=>openAuth("signup");
document.getElementById("heroSignup").onclick=()=>openAuth("signup");
document.getElementById("finalSignup").onclick=()=>openAuth("signup");
document.querySelectorAll(".plan-btn").forEach(function(btn){btn.onclick=()=>openAuth("signup")});
document.getElementById("heroDiscover").onclick=()=>document.getElementById("solution").scrollIntoView({behavior:"smooth"});
}
function feature(icon,title,desc,result,image,alt){return '<div class="feature-card">'+(image?'<img class="feature-image" src="'+image+'" alt="'+esc(alt||title)+'" loading="lazy">':'')+'<div class="feature-icon">'+icon+'</div><h3>'+title+'</h3><p>'+desc+'</p><small>→ '+result+'</small></div>'}
function benefit(n,title,desc){return '<div class="benefit-item"><span>'+n+'</span><div><h3>'+title+'</h3><p>'+desc+'</p></div></div>'}
function plan(name,price,period,features,cta,featured){return '<div class="plan '+(featured?'featured':'')+'">'+(featured?'<div class="popular">LE PLUS CHOISI</div>':'')+'<h3>'+name+'</h3><div class="plan-price">'+price+'<small>'+(period==='Pour démarrer'?'':' / '+period)+'</small></div><p class="plan-for">'+period+'</p><div class="plan-features">'+features+'</div><button class="btn '+(featured?'btn-primary':'btn-secondary')+' full plan-btn">'+cta+'</button></div>'}

function authView(mode,screen){
const isSignup=mode==="signup" || (mode==="phone" && screen==="signup");
const isPhone=mode==="phone";
const isReset=screen==="reset";
if(isReset){
root.innerHTML='<div class="auth-page"><div class="auth-side"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="auth-side-copy"><span class="eyebrow light">RÉCUPÉRATION SÉCURISÉE</span><h1>Retrouvez l’accès à votre espace.</h1><p>Un lien sécurisé vous sera envoyé par email pour choisir un nouveau mot de passe.</p><div class="auth-benefits"><span>✓ Aucun SMS nécessaire</span><span>✓ Lien sécurisé à usage unique</span><span>✓ Nouveau mot de passe immédiatement</span></div></div></div><div class="auth-main"><div class="auth-card auth-modern"><button class="back-link" id="backAuth">← Retour à la connexion</button><div class="auth-icon">↻</div><h2>Mot de passe oublié ?</h2><p class="muted">Entrez l’adresse email associée à votre compte.</p><div class="field"><label>Adresse email</label><input id="resetEmail" type="email" autocomplete="email" placeholder="vous@exemple.com"></div><button class="btn btn-primary full btn-lg" id="sendReset">Recevoir le lien de récupération →</button><div class="auth-msg" id="resetMsg"></div><div class="security-note">🔒 Pour les comptes créés uniquement avec un numéro de téléphone, ajoutez une adresse email de récupération dans Réglages dès que possible. Sans SMS, elle est nécessaire pour une récupération automatique.</div></div></div></div>';
document.getElementById("backAuth").onclick=()=>authView("login");
document.getElementById("sendReset").onclick=async function(){
const email=document.getElementById("resetEmail").value.trim();
const msg=document.getElementById("resetMsg");
if(!email||!email.includes("@")){msg.textContent="Entrez une adresse email valide.";return}
try{
document.getElementById("sendReset").disabled=true;
const {error}=await supabaseClient.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname+"?recovery=1"});
if(error)throw error;
msg.style.color="#067647";
msg.textContent="Si cette adresse correspond à un compte, un lien de récupération vient d’être envoyé.";
}catch(e){msg.textContent=e.message||"Impossible d’envoyer le lien de récupération."}
finally{document.getElementById("sendReset").disabled=false}
};
return;
}
root.innerHTML='<div class="auth-page"><div class="auth-side"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="auth-side-copy"><span class="eyebrow light">VOTRE ESPACE PROFESSIONNEL</span><h1>Un accès simple, sans SMS.</h1><p>Choisissez une connexion simple avec votre adresse email et votre mot de passe.</p><div class="auth-benefits"><span>✓ Email + mot de passe</span><span>✓ Connexion email sécurisée</span><span>✓ Récupération du mot de passe par email</span></div></div></div><div class="auth-main"><div class="auth-card auth-modern"><button class="back-link" id="backHome">← Retour à l’accueil</button><div class="auth-icon">M</div><h2 id="authTitle">'+(isSignup?"Créer mon espace":"Se connecter")+'</h2><p class="muted" id="authSub">'+(isSignup?"Choisissez comment vous souhaitez créer votre compte.":"Choisissez votre méthode de connexion.")+'</p><div class="quick" style="margin:18px 0 4px"><button class="btn '+(!isPhone?'btn-primary':'btn-secondary')+'" id="emailMode">✉ Email</button><button class="btn '+(isPhone?'btn-primary':'btn-secondary')+'" id="phoneMode">☎ Téléphone</button></div><div id="authForm"></div><div class="auth-msg" id="authMsg"></div><p class="auth-switch">'+(isSignup?'Vous avez déjà un compte ? <span class="link" id="switchAuth">Se connecter</span>':'Nouveau ici ? <span class="link" id="switchAuth">Créer mon espace</span>')+'</p><div class="security-note">🔒 Aucun SMS n’est utilisé. La récupération du mot de passe se fait par email.</div></div></div></div>';
document.getElementById("backHome").onclick=landingView;
document.getElementById("emailMode").onclick=()=>authView(mode==="login"?"login":"signup");document.getElementById("phoneMode").style.display="none";
document.getElementById("phoneMode").onclick=()=>authView("phone",isSignup?"signup":"login");
document.getElementById("switchAuth").onclick=()=>isPhone?authView("phone",isSignup?"login":"signup"):authView(isSignup?"login":"signup");
const form=document.getElementById("authForm");
const forgot=!isSignup&&!isPhone?'<div style="text-align:right;margin-top:8px"><span class="link" id="forgotPassword">Mot de passe oublié ?</span></div>':"";
if(isPhone){
form.innerHTML='<div class="phone-field"><select id="countryCode"><option value="+229" selected>🇧🇯 +229</option><option value="+228">🇹🇬 +228</option><option value="+225">🇨🇮 +225</option><option value="+221">🇸🇳 +221</option><option value="+237">🇨🇲 +237</option></select><input id="phone" inputmode="tel" autocomplete="tel" placeholder="90 00 00 00"></div><div class="field"><label>Mot de passe</label><input id="phonePassword" type="password" autocomplete="'+(isSignup?"new-password":"current-password")+'" placeholder="Au moins 8 caractères"></div>'+(isSignup?'<div class="field"><label>Email de récupération <span class="muted">(recommandé)</span></label><input id="phoneRecoveryEmail" type="email" autocomplete="email" placeholder="vous@exemple.com"></div>':"")+'<button class="btn btn-primary full btn-lg" id="phoneSubmit">'+(isSignup?"Créer mon compte →":"Se connecter →")+'</button>';
}else{
form.innerHTML=(isSignup?'<div class="field"><label>Votre nom</label><input id="fullName" type="text" autocomplete="name" placeholder="Ex. David"></div>':'')+'<div class="field"><label>Adresse email</label><input id="email" type="email" autocomplete="email" placeholder="vous@exemple.com"></div><div class="field"><label>Mot de passe</label><input id="emailPassword" type="password" autocomplete="'+(isSignup?"new-password":"current-password")+'" placeholder="Au moins 8 caractères"></div><button class="btn btn-primary full btn-lg" id="emailSubmit">'+(isSignup?"Créer mon compte →":"Se connecter →")+'</button>'+forgot;
}
async function submit(){
const msg=document.getElementById("authMsg");
try{await initSupabase()}catch(e){msg.textContent=e.message||"Le module de connexion est indisponible.";msg.style.color="#d92d20";return}
msg.textContent="";
try{
if(isPhone){
const raw=document.getElementById("phone").value.replace(/\D/g,"");
const phone=document.getElementById("countryCode").value+raw;
const password=document.getElementById("phonePassword").value;
if(raw.length<7)throw Error("Entrez un numéro de téléphone valide.");
if(password.length<8)throw Error("Le mot de passe doit contenir au moins 8 caractères.");
if(isSignup){
const recovery=document.getElementById("phoneRecoveryEmail")?.value.trim()||"";
const {data,error}=await supabaseClient.auth.signUp({phone,password});
if(error)throw error;
if(!data.session){msg.style.color="#067647";msg.textContent="Compte créé. La confirmation du téléphone doit rester désactivée pour utiliser ce mode sans SMS.";return}
if(recovery){const {error:emailError}=await supabaseClient.auth.updateUser({email:recovery});if(emailError){msg.style.color="#b54708";msg.textContent="Compte créé, mais l’email de récupération n’a pas pu être ajouté. Ajoutez-le ensuite dans Réglages.";return}}
await boot();
}else{
const {error}=await supabaseClient.auth.signInWithPassword({phone,password});
if(error)throw error;
await boot();
}
}else{
const email=document.getElementById("email").value.trim();
const password=document.getElementById("emailPassword").value;
if(!email||!email.includes("@"))throw Error("Entrez une adresse email valide.");
if(password.length<8)throw Error("Le mot de passe doit contenir au moins 8 caractères.");
if(isSignup){
const fullName=document.getElementById("fullName")?.value.trim()||"";
if(!fullName)throw Error("Entrez votre nom.");
const {data,error}=await supabaseClient.auth.signUp({email,password,options:{data:{full_name:fullName},emailRedirectTo:location.origin+"/"}});
if(error)throw error;
if(!data.session){msg.style.color="#b54708";msg.textContent="Compte créé. Vérifiez votre email pour confirmer le compte, puis revenez vous connecter.";return}
await boot();
}else{
const {error}=await supabaseClient.auth.signInWithPassword({email,password});
if(error){
  const message=String(error.message||"");
  if(error.code==="email_not_confirmed" || /email.*confirm/i.test(message)){
    try{await supabaseClient.auth.resend({type:"signup",email});}catch{}
    msg.style.color="#b54708";
    msg.textContent="Votre adresse email n’est pas encore confirmée. Vérifiez votre boîte mail. Un nouveau lien de confirmation a été demandé.";
    return;
  }
  throw error;
}
await boot();
}
}
}catch(e){msg.style.color="#d92d20";msg.textContent=e.message||"Impossible de poursuivre."}
}
document.getElementById("emailSubmit")?.addEventListener("click",submit);
document.getElementById("phoneSubmit")?.addEventListener("click",submit);
document.getElementById("forgotPassword")?.addEventListener("click",()=>authView("login","reset"));
}

function recoveryView(){
root.innerHTML='<div class="auth-page"><div class="auth-side"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="auth-side-copy"><span class="eyebrow light">NOUVEAU MOT DE PASSE</span><h1>Sécurisez à nouveau votre espace.</h1><p>Choisissez un nouveau mot de passe. Vous pourrez ensuite vous reconnecter normalement.</p></div></div><div class="auth-main"><div class="auth-card auth-modern"><div class="auth-icon">✓</div><h2>Nouveau mot de passe</h2><p class="muted">Utilisez un mot de passe d’au moins 8 caractères.</p><div class="field"><label>Nouveau mot de passe</label><input id="newPassword" type="password" autocomplete="new-password" placeholder="Au moins 8 caractères"></div><div class="field"><label>Confirmer le mot de passe</label><input id="newPassword2" type="password" autocomplete="new-password" placeholder="Répétez le mot de passe"></div><button class="btn btn-primary full btn-lg" id="savePassword">Enregistrer le nouveau mot de passe →</button><div class="auth-msg" id="recoveryMsg"></div></div></div></div>';
document.getElementById("savePassword").onclick=async function(){
const p=document.getElementById("newPassword").value;
const p2=document.getElementById("newPassword2").value;
const msg=document.getElementById("recoveryMsg");
if(p.length<8){msg.textContent="Le mot de passe doit contenir au moins 8 caractères.";return}
if(p!==p2){msg.textContent="Les deux mots de passe ne correspondent pas.";return}
try{
const {error}=await supabaseClient.auth.updateUser({password:p});
if(error)throw error;
msg.style.color="#067647";msg.textContent="Mot de passe modifié. Connexion en cours…";
setTimeout(()=>boot(),700);
}catch(e){msg.textContent=e.message||"Impossible de modifier le mot de passe."}
};
}
function shell(){
root.innerHTML='<div class="shell"><aside class="sidebar"><div class="side-brand"><div class="brand"><div class="logo">M</div><span>Mon Assistant Pro</span></div></div><nav class="nav" id="nav"><button data-page="dashboard">⌂ <span>Vue d’ensemble</span></button><button data-page="activity">◈ <span>Mon activité</span></button><button data-page="products">▣ <span>Produits & services</span></button><button data-page="sales">↗ <span>Ventes</span></button><button data-page="customers">◎ <span>Clients</span></button><button data-page="assistant">✦ <span>Assistant Pro</span></button><button data-page="preview">◉ <span>Ma page</span></button><button data-page="settings">⚙ <span>Réglages</span></button></nav><div class="side-bottom"><div class="user-mini"><b id="sideUserName">Mon espace</b><br><span id="sideEmail" style="color:#7f8a9e"></span></div></div></aside><main class="main"><header class="topbar"><div class="top-title" id="topTitle">Vue d’ensemble</div><div style="display:flex;gap:9px;align-items:center"><button class="btn btn-soft mobile-menu" id="quickAssistant">✦ Assistant</button><button class="btn btn-secondary" id="logout">Déconnexion</button></div></header><div class="content" id="content"></div></main></div>';
document.querySelectorAll("#nav button").forEach(function(b){b.onclick=function(){state.page=b.dataset.page;renderPage()}});
document.getElementById("logout").onclick=async function(){await supabaseClient.auth.signOut();landingView()};
document.getElementById("quickAssistant").onclick=function(){state.page="assistant";renderPage()};
}

function onboarding(){
root.innerHTML='<div class="login-box" style="min-height:100vh;background:#f6f7fb"><div class="onboarding"><div class="brand" style="margin-bottom:22px"><div class="logo">M</div><span>Mon Assistant Pro</span></div><div class="panel"><div class="steps"><div class="step done"></div><div class="step"></div><div class="step"></div></div><h1 style="font-size:34px;letter-spacing:-.05em;margin:0">Bienvenue '+(state.user?.user_metadata?.full_name?esc(state.user.user_metadata.full_name):"")+' 👋</h1><h2 style="font-size:24px;margin:10px 0 0">Commençons par votre activité</h2><p class="muted">Ces informations permettent à votre assistant de comprendre votre contexte.</p><div class="form-grid" style="margin-top:24px"><div class="field"><label>Nom de l’activité *</label><input id="bName" placeholder="Ex. Chez David"></div><div class="field"><label>Type d’activité</label><input id="bType" placeholder="Restaurant, boutique, service..."></div><div class="field"><label>Ville</label><input id="bCity" placeholder="Cotonou, Abomey-Calavi..."></div><div class="field"><label>Téléphone / WhatsApp</label><input id="bPhone" placeholder="+229 ..."></div></div><div class="field"><label>Que proposez-vous ?</label><textarea id="bDesc" rows="4" placeholder="Décrivez simplement vos produits ou services."></textarea></div><div class="field"><label>Votre objectif principal</label><textarea id="bObj" rows="3" placeholder="Ex. Trouver plus de clients et augmenter mes ventes."></textarea></div><button class="btn btn-primary full" id="createBusiness">Créer mon espace professionnel →</button></div></div></div>';
document.getElementById("createBusiness").onclick=async function(){const name=document.getElementById("bName").value.trim();if(!name)return toast("Le nom de votre activité est obligatoire.");try{await call("/api/business",{method:"POST",body:JSON.stringify({name:name,type:document.getElementById("bType").value,city:document.getElementById("bCity").value,phone:document.getElementById("bPhone").value,description:document.getElementById("bDesc").value,objective:document.getElementById("bObj").value})});await boot()}catch(e){toast(e.message)}};
}

async function loadData(){
const results=await Promise.allSettled([
  call("/api/products"),
  call("/api/sales"),
  call("/api/customers"),
  call("/api/summary")
]);
state.products=results[0].status==="fulfilled" ? (results[0].value.products||[]) : [];
state.sales=results[1].status==="fulfilled" ? (results[1].value.sales||[]) : [];
state.customers=results[2].status==="fulfilled" ? (results[2].value.customers||[]) : [];
state.summary=results[3].status==="fulfilled" ? results[3].value.summary : null;
const failed=results.find(function(x){return x.status==="rejected"});
if(failed) console.warn("Certaines données secondaires n'ont pas pu être chargées.",failed.reason);
}
async function boot(){
const s=await session();if(!s){landingView();return;}
state.user=s.user||null;
try{
  const me=await call("/api/me");
  state.business=me.business||null;
  if(!state.business){onboarding();return;}
  await loadData(); shell(); renderPage();
}catch(e){ console.error("boot",e); toast(e.message||"Impossible de charger votre espace. Réessayez."); }
}

function setActive(){document.querySelectorAll("#nav button").forEach(function(b){b.classList.toggle("active",b.dataset.page===state.page)})}
function renderPage(){
setActive();const b=state.business||{};const titles={dashboard:"Vue d’ensemble",activity:"Mon activité",products:"Produits & services",sales:"Ventes",customers:"Clients",assistant:"Assistant Pro",preview:"Ma page commerciale",settings:"Réglages"};
document.getElementById("topTitle").textContent=titles[state.page]||"Mon Assistant Pro";document.getElementById("sideUserName").textContent=(state.user?.user_metadata?.full_name||"Mon espace").trim();
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
return head("Ma page commerciale","La vitrine que vos futurs clients pourront découvrir.","<button class='btn btn-secondary' id='copyPage'>Copier le lien</button>")+'<div class="preview"><div class="preview-hero"><span class="pill">Disponible avec Mon Assistant Pro</span><h2>'+esc(b.name||"Votre activité")+'</h2><p style="color:#d8dbe8;max-width:600px">'+esc(b.description||"Une activité présentée clairement, avec vos produits et un assistant commercial.")+'</p><div class="quick"><button class="btn" data-go="products" style="background:#fff;color:#302b68">Voir les produits</button><button class="btn" data-go="assistant" style="background:rgba(255,255,255,.12);color:#fff">Parler à l’assistant</button></div></div><div class="preview-body"><h3>Nos produits & services</h3><div class="grid product-grid" style="margin-top:15px">'+products+'</div></div></div>';
}

function settingsView(){const name=state.user?.user_metadata?.full_name||"";return head("Réglages","Les paramètres essentiels de votre espace.")+'<div class="grid three"><div class="panel"><h3>Compte</h3><div class="panel-sub">Connexion et sécurité.</div><span class="badge green">Compte actif</span><div class="field" style="margin-top:18px"><label>Votre nom</label><input id="profileName" value="'+esc(name)+'" placeholder="Votre nom"></div><button class="btn btn-primary full" id="saveProfileName">Enregistrer mon nom</button><div class="auth-msg" id="profileNameMsg"></div><div class="field"><label>Email de récupération</label><input id="recoveryEmailSetting" type="email" placeholder="vous@exemple.com"></div><button class="btn btn-primary full" id="saveRecoveryEmail">Enregistrer mon email</button><div class="auth-msg" id="recoverySettingMsg"></div><div class="security-note" style="margin-top:12px">Votre session reste enregistrée sur cet appareil jusqu’à votre déconnexion. L’email sert à récupérer le mot de passe si vous l’oubliez.</div></div><div class="panel"><h3>Assistant IA</h3><div class="panel-sub">Moteur actuellement utilisé.</div><b>Cloudflare Workers AI</b><br><span class="muted">Llama 3.2 3B</span></div><div class="panel"><h3>Plan</h3><div class="panel-sub">Configuration actuelle.</div><b>Essentiel</b><br><span class="muted">Les fonctions avancées pourront évoluer avec votre activité.</span></div></div>'}

function bindPage(){
document.querySelectorAll("[data-go]").forEach(function(x){x.onclick=function(){state.page=x.dataset.go;renderPage()}});
document.querySelectorAll("[data-open]").forEach(function(x){x.onclick=function(){if(x.dataset.open==="product")openProduct();if(x.dataset.open==="sale")openSale()}});
if(document.getElementById("saveActivity"))document.getElementById("saveActivity").onclick=saveActivity;
if(document.getElementById("sendAssistant"))document.getElementById("sendAssistant").onclick=function(){sendAssistant(document.getElementById("assistantInput").value)};
document.querySelectorAll(".quickAsk").forEach(function(x){x.onclick=function(){sendAssistant(x.dataset.q)}});
if(document.getElementById("copyPage"))document.getElementById("copyPage").onclick=function(){navigator.clipboard?.writeText(location.href);toast("Lien de cette page copié.")};
if(document.getElementById("saveProfileName"))document.getElementById("saveProfileName").onclick=async function(){const name=document.getElementById("profileName").value.trim();const msg=document.getElementById("profileNameMsg");if(!name){msg.textContent="Entrez votre nom.";return}try{const {data,error}=await supabaseClient.auth.updateUser({data:{full_name:name}});if(error)throw error;state.user=data.user||state.user;msg.style.color="#067647";msg.textContent="Nom enregistré.";renderPage()}catch(e){msg.textContent=e.message||"Impossible d’enregistrer votre nom."}};
if(document.getElementById("saveRecoveryEmail"))document.getElementById("saveRecoveryEmail").onclick=async function(){const email=document.getElementById("recoveryEmailSetting").value.trim();const msg=document.getElementById("recoverySettingMsg");if(!email||!email.includes("@")){msg.textContent="Entrez une adresse email valide.";return}try{const {error}=await supabaseClient.auth.updateUser({email});if(error)throw error;msg.style.color="#067647";msg.textContent="Email enregistré. Vérifiez votre boîte mail si une confirmation est demandée."}catch(e){msg.textContent=e.message||"Impossible d’enregistrer l’email."}};
session().then(function(s){if(s&&s.user&&s.user.email&&document.getElementById("recoveryEmailSetting"))document.getElementById("recoveryEmailSetting").value=s.user.email});
}
async function saveActivity(){try{const b=state.business;const body={name:document.getElementById("editName").value,type:document.getElementById("editType").value,city:document.getElementById("editCity").value,phone:document.getElementById("editPhone").value,description:document.getElementById("editDesc").value,objective:document.getElementById("editObj").value};const r=await call("/api/business",{method:"PATCH",body:JSON.stringify(body)});state.business=r.business||b;toast("Informations enregistrées.");renderPage()}catch(e){toast(e.message)}}
function modal(title,body){const div=document.createElement("div");div.style.cssText="position:fixed;inset:0;background:rgba(16,24,40,.45);z-index:30;display:grid;place-items:center;padding:18px";div.innerHTML='<div class="panel" style="width:min(520px,100%)"><div style="display:flex;justify-content:space-between;align-items:center"><h3>'+title+'</h3><button class="btn btn-secondary" id="closeModal">Fermer</button></div>'+body+'</div>';document.body.appendChild(div);document.getElementById("closeModal").onclick=function(){div.remove()};return div}
function openProduct(){const m=modal("Ajouter un produit ou service",'<div class="field"><label>Nom</label><input id="mName"></div><div class="field"><label>Prix (FCFA)</label><input id="mPrice" type="number"></div><div class="field"><label>Stock</label><input id="mStock" type="number" value="0"></div><div class="field"><label>Description</label><textarea id="mDesc" rows="3"></textarea></div><button class="btn btn-primary full" id="mSave">Ajouter au catalogue</button>');m.querySelector("#mSave").onclick=async function(){try{await call("/api/products",{method:"POST",body:JSON.stringify({name:m.querySelector("#mName").value,price:m.querySelector("#mPrice").value,stock:m.querySelector("#mStock").value,description:m.querySelector("#mDesc").value})});m.remove();await loadData();renderPage();toast("Produit ajouté.");}catch(e){toast(e.message)}}}
function openSale(){const m=modal("Enregistrer une vente",'<div class="field"><label>Montant total (FCFA)</label><input id="sTotal" type="number" placeholder="5000"></div><div class="field"><label>Mode de paiement</label><select id="sPay"><option value="cash">Espèces</option><option value="mobile_money">Mobile Money</option><option value="other">Autre</option></select></div><button class="btn btn-primary full" id="sSave">Enregistrer la vente</button>');m.querySelector("#sSave").onclick=async function(){try{await call("/api/sales",{method:"POST",body:JSON.stringify({total:m.querySelector("#sTotal").value,payment_method:m.querySelector("#sPay").value})});m.remove();await loadData();state.page="dashboard";renderPage();toast("Vente enregistrée.");}catch(e){toast(e.message)}}}
async function sendAssistant(q){q=String(q||"").trim();if(!q)return;const chat=document.getElementById("chat");if(!chat)return;chat.innerHTML+='<div class="bubble user">'+esc(q)+'</div>';chat.innerHTML+='<div class="bubble ai" id="thinking">Analyse en cours…</div>';chat.scrollTop=chat.scrollHeight;try{const d=await call("/api/assistant",{method:"POST",body:JSON.stringify({message:q})});const t=document.getElementById("thinking");if(t)t.outerHTML='<div class="bubble ai">'+esc(d.answer||"Je n’ai pas pu répondre.")+'</div>'}catch(e){const t=document.getElementById("thinking");if(t)t.outerHTML='<div class="bubble ai">Je rencontre un problème pour répondre. Réessayez dans un instant.</div>'}chat.scrollTop=chat.scrollHeight}

let supabaseInitPromise=null;
function loadScript(src){
return new Promise(function(resolve,reject){
  var s=document.createElement("script");
  s.src=src;
  s.async=true;
  s.onload=function(){resolve()};
  s.onerror=function(){reject(new Error("Impossible de charger le module de connexion."))};
  document.head.appendChild(s);
});
}
async function initSupabase(){
if(supabaseClient)return supabaseClient;
if(supabaseInitPromise)return supabaseInitPromise;
supabaseInitPromise=(async function(){
if(!window.supabase || typeof window.supabase.createClient!=="function"){
  var sources=[
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
    "https://unpkg.com/@supabase/supabase-js@2"
  ];
  var loaded=false;
  for(var i=0;i<sources.length;i++){
    try{await loadScript(sources[i]);if(window.supabase && typeof window.supabase.createClient==="function"){loaded=true;break}}catch(e){}
  }
  if(!loaded)throw new Error("Le module de connexion est indisponible.");
}
supabaseClient=window.supabase.createClient(SUPA_URL,SUPA_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:"mon-assistant-pro-auth"}});
supabaseClient.auth.onAuthStateChange(function(event,s){if(event==="SIGNED_OUT")landingView();if(event==="PASSWORD_RECOVERY")recoveryView();});
return supabaseClient;
})();
try{return await supabaseInitPromise}catch(e){supabaseInitPromise=null;throw e}
}
function bindFallbackAuth(){
  if(window.__authEntryPointsBound)return;
  window.__authEntryPointsBound=true;
  document.addEventListener("click",function(e){
    var el=e.target&&e.target.closest?e.target.closest("#goLogin,#goSignup,#heroSignup,#finalSignup,#fallbackLogin,#fallbackSignup,#fallbackHeroSignup,#fallbackFinalSignup,#fallbackPlanFree,#fallbackPlanPro,#fallbackPlanPlus,.plan-btn"):null;
    if(!el)return;
    e.preventDefault();
    e.stopPropagation();
    openAuth((el.id==="goLogin"||el.id==="fallbackLogin")?"login":"signup");
  },true);
}
bindFallbackAuth();
landingView();
initSupabase().then(function(){return boot()}).catch(function(e){console.error(e);/* La page d’accueil reste volontairement visible si le module de connexion est indisponible. */});
</script>
</body></html>`;
