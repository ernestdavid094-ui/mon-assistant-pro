import fs from "node:fs";

const source=fs.readFileSync("src/index.js","utf8");
const required=[
  'function landingView()',
  'function authView(mode,screen)',
  'async function openAuth(mode,screen)',
  'document.getElementById("goLogin").onclick=()=>openAuth("login")',
  'document.getElementById("goSignup").onclick=()=>openAuth("signup")',
  'document.querySelectorAll(".plan-btn")',
  '/images/assistant-entrepreneur.webp',
  '/images/photographe-vitrine.webp',
  '/images/assistant-smartphone.webp',
  '/images/comptoir-boutique.webp',
  '/images/page-contact.webp',
  'async function api(req, env)',
  'if(env.ASSETS)'
];
for(const marker of required){
  if(!source.includes(marker)) throw new Error("Régression détectée: "+marker);
}
const match=source.match(/<script>([\s\S]*?)<\/script>/);
if(!match) throw new Error("Script principal introuvable.");
try{new Function(match[1]);}catch(error){throw new Error("Erreur JavaScript: "+error.message);}
console.log("OK — structure, authentification, assets et JavaScript vérifiés.");
