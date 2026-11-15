const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{t1:'34px',t2:'30px',gap:'22px',logo:'170px',pb:'50px',h1:'92px',badge:'30px',p:'32px',url:'26px',board:'27px'}],
 ['historia.png',1080,1920,{t1:'150px',t2:'150px',gap:'44px',logo:'300px',h1:'110px',badge:'40px',p:'44px',url:'34px',board:'36px'}],
 ['portada-horizontal.png',1200,630,{t1:'-6px',t2:'-6px',tape:'48px',tapefs:'18px',logod:'none',gap:'14px',logo:'110px',h1:'60px',badge:'22px',p:'24px',url:'20px',board:'20px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
