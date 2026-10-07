import fs from "node:fs";

const src=fs.readFileSync("src/index.js","utf8");
const checks=[
  ["landing login button", /id="goLogin"/],
  ["landing signup button", /id="goSignup"/],
  ["single landing root", /function landingView\(\)/],
  ["no fallback landing markup", !/<div id="root"><div class="landing">/.test(src)],
  ["landing auth delegation", /closest\("#goLogin,#goSignup,#heroSignup,#finalSignup/.test(src)],
  ["email signup", /auth\.signUp\(\{email,password/],
  ["email login", /auth\.signInWithPassword\(\{email,password\}/],
  ["server user validation", /authenticatedUser\(env,token\)/],
  ["business ownership", /owner_id:u\.id/],
  ["business bootstrap", /call\("\/api\/me"\)/],
  ["AI route", /p==="\/api\/assistant"/],
  ["Cloudflare AI model", /@cf\/meta\/llama-3\.2-3b-instruct/],
  ["preview assistant action", /data-go="assistant"/],
  ["single worker root handler", /if\(url\.pathname === "\/" \|\| url\.pathname === "\/index\.html"\)/],
  ["no duplicate root handler", ((src.match(/if\(url\.pathname === "\/" \|\| url\.pathname === "\/index\.html"\)/g)||[]).length===1)],
  ["dashboard navigation", /data-page="dashboard"/],
  ["activity navigation", /data-page="activity"/],
  ["products navigation", /data-page="products"/],
  ["sales navigation", /data-page="sales"/],
  ["customers navigation", /data-page="customers"/],
  ["assistant navigation", /data-page="assistant"/],
  ["preview navigation", /data-page="preview"/],
  ["settings navigation", /data-page="settings"/],
  ["navigation handler", /state\.page=b\.dataset\.page/],
  ["email confirmation handling", /email_not_confirmed/],
  ["confirmation resend", /auth\.resend\(\{type:"signup",email\}\)/],
  ["onboarding action", /id="createBusiness"/],
  ["logout action", /auth\.signOut\(\)/],
];
const failures=checks.filter(([name,re])=>{
  const ok = re instanceof RegExp ? re.test(src) : re;
  return !ok;
});
if(failures.length){
  console.error("Regression checks failed:");
  for(const [name] of failures) console.error(" - "+name);
  process.exit(1);
}
console.log("Regression checks passed:",checks.length);
