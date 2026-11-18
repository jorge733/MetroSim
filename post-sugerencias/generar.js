const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'22px',logo:'90px',badge:'26px',h1:'78px',dw:'640px',tag:'20px',cw:'760px',cgap:'12px',cpad:'8px 18px',p:'23px',url:'50px',bpad:'14px 42px'}],
 ['historia.png',1080,1920,{gap:'56px',logo:'130px',badge:'34px',h1:'128px',dw:'960px',tag:'30px',cw:'960px',cgap:'16px',cpad:'10px 24px',p:'32px',url:'68px',bpad:'20px 56px'}],
 ['portada-horizontal.png',1200,630,{horiz:'1',gap:'18px',logo:'60px',badge:'18px',h1:'64px',dw:'600px',tag:'14px',cw:'470px',cgap:'8px',cpad:'6px 14px',p:'16px',url:'34px',bpad:'10px 30px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');document.body.classList.toggle('h',!!v.horiz);for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
