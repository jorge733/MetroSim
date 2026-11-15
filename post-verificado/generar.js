const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'24px',seal:'190px',badge:'26px',h1:'82px',card:'42px',p:'30px',url:'30px'}],
 ['historia.png',1080,1920,{gap:'56px',seal:'340px',badge:'38px',h1:'112px',card:'56px',p:'38px',url:'40px',linesw:'640px',hb:'inline'}],
 ['portada-horizontal.png',1200,630,{dir:'row',ta:'left',ai:'flex-start',gap:'18px',seal:'300px',badge:'18px',h1:'60px',card:'28px',p:'20px',url:'20px',linesw:'420px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
