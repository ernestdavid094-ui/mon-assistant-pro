import fs from "node:fs";

const src=fs.readFileSync("src/index.js","utf8");
const checks=[
  ["landing login button", /id="goLogin"/],
  ["landing signup button", /id="goSignup"/],
  ["fallback login handler", /id="fallbackLogin"[^>]*onclick="openAuth\('login'\)"/],
  ["fallback signup handler", /id="fallbackSignup"[^>]*onclick="openAuth\('signup'\)"/],
  ["delegated fallback auth", /#fallbackLogin,#fallbackSignup,#fallbackHeroSignup/],
  ["email signup", /auth\.signUp\(\{email,password/],
  ["email login", /auth\.signInWithPassword\(\{email,password\}/],
  ["server user validation", /authenticatedUser\(env,token\)/],
  ["business ownership", /owner_id:u\.id/],
  ["business bootstrap", /call\("\/api\/me"\)/],
  ["AI route", /p==="\/api\/assistant"/],
  ["Cloudflare AI model", /@cf\/meta\/llama-3\.2-3b-instruct/],
  ["preview assistant action", /data-go="assistant"/],
];
const failures=checks.filter(([name,re])=>!re.test(src));
if(failures.length){
  console.error("Regression checks failed:");
  for(const [name] of failures) console.error(" - "+name);
  process.exit(1);
}
console.log("Regression checks passed:",checks.length);
