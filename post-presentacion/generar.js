const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'20px',logo:'96px',badge:'28px',h1:'72px',dw:'740px',tag:'24px',url:'58px',bpad:'18px 46px',p:'30px'}],
 ['historia.png',1080,1920,{gap:'64px',logo:'150px',badge:'38px',h1:'104px',dw:'960px',tag:'30px',url:'78px',bpad:'26px 60px',p:'36px'}],
 ['portada-horizontal.png',1200,630,{gap:'10px',logo:'50px',badge:'17px',h1:'40px',dw:'440px',tag:'14px',url:'32px',bpad:'8px 28px',p:'18px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
