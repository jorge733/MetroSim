const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();
const f='file://'+path.resolve(process.argv[2]);
const sizes=[
 ['post-cuadrado.png',1080,1080,'sq',{u:'23px',dir:'column',gap:'20px',cg:'14px',pad:'60px',cw:'330px',pw:'820px'}],
 ['historia.png',1080,1920,'st',{u:'38px',dir:'column',gap:'60px',cg:'40px',pad:'70px',cw:'680px',pw:'920px'}],
 ['portada-horizontal.png',1200,630,'land',{u:'19px',dir:'row',gap:'44px',cg:'14px',pad:'50px',cw:'300px',pw:'500px'}]];
for(const [n,w,h,c,v] of sizes){const p=await b.newPage({viewport:{width:w,height:h},deviceScaleFactor:1});
await p.goto(f);await p.evaluate(([w,h,c,v])=>{document.body.className=c;const s=document.documentElement.style;s.setProperty('--w',w+'px');s.setProperty('--h',h+'px');for(const k in v)s.setProperty('--'+k,v[k]);},[w,h,c,v]);
await p.waitForTimeout(300);
await p.screenshot({path:n});await p.close();}
await b.close();})();
