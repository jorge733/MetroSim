const {chromium}=require('playwright');const path=require('path');
// Uso: node generar.js plantilla.html  (desde esta carpeta)
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'20px',logo:'60px',badge:'20px',qw:'860px',q:'21px',h1:'58px',pw:'470px',sw:'980px',sg:'20px',tag:'19px',cw:'980px',cgap:'10px',cpad:'6px 16px',p:'19px',url:'34px',bpad:'10px 32px'}],
 ['post-vertical.png',1080,1350,{gap:'30px',logo:'80px',badge:'24px',qw:'900px',q:'25px',h1:'74px',pw:'470px',sw:'980px',sg:'22px',tag:'21px',cw:'960px',cgap:'12px',cpad:'8px 18px',p:'22px',url:'44px',bpad:'12px 40px'}],
 ['historia.png',1080,1920,{gap:'46px',logo:'100px',badge:'28px',qw:'940px',q:'28px',h1:'70px',pw:'780px',sw:'960px',sg:'30px',tag:'28px',cw:'960px',cgap:'16px',cpad:'10px 22px',p:'25px',url:'54px',bpad:'14px 46px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
const r=await p.evaluate(()=>{const w=document.querySelector('.wrap');return [w.scrollHeight,innerHeight]});console.log(n,r);
await p.screenshot({path:n});await p.close();}
await b.close();})();
