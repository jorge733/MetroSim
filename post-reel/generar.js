// Arma el reel (1080×1920, 30 fps) con plantilla.html, las tomas de clips/ y musica.wav.
// Uso (desde esta carpeta):  python3 musica.py 27 && node generar.js   → reel.mp4 y portada.jpg
const {chromium}=require('playwright');const path=require('path');const fs=require('fs');const os=require('os');const {execFileSync}=require('child_process');
const FPS=30,Q=['-v','error','-y'];
(async()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reel-'));
 // 1. Cuadros de cada toma (clips/*.mp4 grabados del juego a 844×390)
 const clips={};
 for(const f of fs.readdirSync('clips').filter(f=>f.endsWith('.mp4'))){const n=f.slice(0,-4),d=path.join(tmp,n);fs.mkdirSync(d);
  execFileSync('ffmpeg',[...Q,'-i',path.join('clips',f),'-q:v','2',path.join(d,'%04d.jpg')]);clips[n]={dir:d,count:fs.readdirSync(d).length};}
 const out=path.join(tmp,'out');fs.mkdirSync(out);
 // 2. Cada cuadro del reel
 const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
 await p.goto('file://'+path.resolve('plantilla.html'));await p.evaluate(()=>document.fonts.ready);
 const dur=await p.evaluate(()=>DUR),total=Math.round(dur*FPS);let last='';
 for(let k=0;k<total;k++){const t=k/FPS;
  const r=await p.evaluate(t=>{const r=render(t);return {shot:r.shot,st:r.st};},t);const sh=r.shot;let src,tf='none';
  if(sh.clip){const c=clips[sh.clip];const i=Math.min(c.count,1+(sh.from||0)+Math.floor(r.st*FPS));src='file://'+path.join(c.dir,String(i).padStart(4,'0')+'.jpg');}
  else{src='file://'+path.resolve(sh.still);const z=1.03+0.05*r.st/2.5;tf=`scale(${z}) translateX(${-r.st*6}px)`;}
  await p.evaluate(async([src,tf,ch])=>{const im=document.getElementById('imA');if(ch){im.src=src;await im.decode().catch(()=>{});}im.style.transform=tf;},[src,tf,src!==last]);last=src;
  await p.screenshot({path:path.join(out,String(k).padStart(4,'0')+'.jpg'),type:'jpeg',quality:94});
  if(k===Math.round(4.2*FPS))fs.copyFileSync(path.join(out,String(k).padStart(4,'0')+'.jpg'),'portada.jpg');
  if(k%60===0)process.stdout.write(`${k}/${total} `);}
 await b.close();
 // 3. Vídeo con música
 execFileSync('ffmpeg',[...Q,'-framerate',String(FPS),'-i',path.join(out,'%04d.jpg'),'-i','musica.wav','-c:v','libx264','-preset','slow','-crf','19','-pix_fmt','yuv420p',
  '-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart','reel.mp4']);
 fs.rmSync(tmp,{recursive:true,force:true});console.log('\nreel.mp4 listo');
})();
