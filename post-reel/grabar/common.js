// Graba tomas del juego con un reloj virtual (requiere el juego servido en localhost:8123: npx http-server -p 8123 .)
// Uso: cd grabar y luego node metro.js 1, node busclip.js, node control.js o node intro.js → clip-*/ (cuadros JPEG)
const {chromium}=require('playwright');
exports.open=async(opts={})=>{const b=await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const ctx=await b.newContext({viewport:{width:opts.w||844,height:opts.h||390},deviceScaleFactor:opts.dsf||1,hasTouch:true,isMobile:false,timezoneId:'America/Santiago',locale:'es-CL'});
await ctx.addInitScript(()=>{try{if(!localStorage.getItem('metrosim.rider'))localStorage.setItem('metrosim.rider',JSON.stringify({birth:'',student:false,tam:false,skipped:true}));localStorage.setItem('metrosim.creator','53f0dc5413de06f519b655108e75d723b62aaff3fe7037e2bbf71167591babb1');}catch{}});
await ctx.addInitScript({path:__dirname+'/vt.js'});
const p=await ctx.newPage();
p.on('console',m=>{if(m.type()==='error')console.log('ERR',m.text().slice(0,200))});
p.on('pageerror',e=>console.log('PAGEERR',e.message));
await p.goto('http://localhost:8123/');await p.waitForTimeout(opts.keepIntro?400:2500);
if(!opts.keepIntro){await p.keyboard.press('Escape');await p.waitForTimeout(1200);}return {b,p};};
exports.click=(p,sel)=>p.evaluate(s=>document.querySelector(s).click(),sel);
exports.waitGame=async(p,ms=240000)=>{await p.waitForFunction(()=>document.getElementById('loadingScreen').classList.contains('hidden')&&!document.getElementById('gameScreen').classList.contains('hidden'),null,{timeout:ms,polling:1000});};
const fs=require('fs');
// Graba n cuadros a 30 fps con el reloj virtual (JPEG de alta calidad)
exports.rec=async(p,dir,n,{fps=30,every}={})=>{fs.mkdirSync(dir,{recursive:true});await p.evaluate(()=>__vt.on());
for(let i=0;i<n;i++){await p.evaluate(ms=>__vt.step(ms),1000/fps);if(every)await every(i);await p.screenshot({path:`${dir}/${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:92});}
};
// Avanza el juego sin grabar (cuadros más largos, más rápido)
exports.ff=async(p,secs,stepMs=100)=>{await p.evaluate(()=>__vt.on());for(let t=0;t<secs*1000;t+=stepMs)await p.evaluate(ms=>__vt.step(ms),stepMs);};
exports.key=(p,k)=>p.keyboard.press(k);
exports.waitBus=async(p,ms=300000)=>{await p.waitForFunction(()=>!!window.RedMoviSim.bus,null,{timeout:ms,polling:1000});await p.waitForTimeout(4000);};
