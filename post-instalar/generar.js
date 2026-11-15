const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'22px',logo:'90px',badge:'26px',h1:'74px',p:'30px',pw:'300px',mgap:'40px',cgap:'22px',cw:'600px',cpad:'22px 28px',h2:'36px',sgap:'14px',li:'27px',url:'40px'}],
 ['historia.png',1080,1920,{gap:'30px',logo:'120px',badge:'34px',h1:'96px',p:'36px',dir:'column',pw:'290px',mgap:'34px',cdir:'column',cgap:'22px',cw:'900px',cpad:'24px 34px',h2:'44px',sgap:'14px',li:'34px',url:'56px'}],
 ['portada-horizontal.png',1200,630,{gap:'12px',logo:'56px',badge:'18px',h1:'46px',p:'20px',pw:'170px',mgap:'24px',cdir:'row',cgap:'16px',cw:'390px',cpad:'16px 20px',h2:'26px',sgap:'10px',li:'19px',url:'26px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
