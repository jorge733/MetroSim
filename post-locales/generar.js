const {chromium}=require('playwright');const path=require('path');
// Uso: node generar.js plantilla.html  (desde esta carpeta)
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'22px',logo:'64px',badge:'20px',h1:'60px',cols:'2',pw:'440px',sg:'18px',tag:'19px',cw:'980px',cgap:'10px',cpad:'6px 16px',p:'19px',url:'36px',bpad:'10px 34px'}],
 ['post-vertical.png',1080,1350,{gap:'32px',logo:'84px',badge:'24px',h1:'78px',cols:'2',pw:'470px',sg:'22px',tag:'21px',cw:'960px',cgap:'12px',cpad:'8px 18px',p:'22px',url:'46px',bpad:'12px 40px'}],
 ['historia.png',1080,1920,{gap:'80px',logo:'116px',badge:'30px',h1:'86px',cols:'2',pw:'480px',sg:'30px',tag:'22px',cw:'980px',cgap:'14px',cpad:'10px 20px',p:'26px',url:'60px',bpad:'16px 50px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
