const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'26px',logo:'110px',badge:'30px',h1:'78px',dw:'860px',tag:'24px',url:'58px',bpad:'18px 46px',p:'30px'}],
 ['historia.png',1080,1920,{gap:'72px',logo:'170px',badge:'40px',h1:'112px',dw:'960px',tag:'30px',url:'78px',bpad:'26px 60px',p:'40px'}],
 ['portada-horizontal.png',1200,630,{gap:'14px',logo:'60px',badge:'20px',h1:'48px',dw:'500px',tag:'15px',url:'38px',bpad:'10px 32px',p:'20px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
