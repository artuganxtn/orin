import {spawn} from 'node:child_process';import {openSync} from 'node:fs';import {fileURLToPath} from 'node:url';
for(let i=0;i<30;i++){try{await fetch('http://127.0.0.1:9099');break}catch{await new Promise(r=>setTimeout(r,1000))}}
const log=openSync(new URL('../../android-test/support-worker.log',import.meta.url),'a');const child=spawn(process.execPath,[fileURLToPath(new URL('../firebase-functions/qa-support-worker.mjs',import.meta.url))],{env:process.env,stdio:['ignore',log,log],detached:true});child.unref();console.log('Local QA staff process started');
