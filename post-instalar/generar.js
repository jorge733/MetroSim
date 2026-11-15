const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,{gap:'20px',logo:'80px',badge:'24px',h1:'68px',p:'28px',dir:'column',pw:'620px',mgap:'26px',cdir:'row',cgap:'20px',cw:'470px',cpad:'20px 24px',h2:'32px',sgap:'12px',li:'23px',url:'38px'}],
 ['historia.png',1080,1920,{gap:'34px',logo:'120px',badge:'34px',h1:'96px',p:'36px',dir:'column',pw:'900px',mgap:'40px',cdir:'column',cgap:'24px',cw:'900px',cpad:'26px 34px',h2:'46px',sgap:'16px',li:'36px',url:'56px'}],
 ['portada-horizontal.png',1200,630,{gap:'10px',logo:'50px',badge:'18px',h1:'44px',p:'19px',pw:'560px',mgap:'26px',cdir:'column',cgap:'12px',cw:'480px',cpad:'12px 18px',h2:'22px',sgap:'6px',li:'17px',url:'24px'}]];
for(const [n,w,h,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,v])=>{const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,v]);
await p.screenshot({path:n});await p.close();}
await b.close();})();
