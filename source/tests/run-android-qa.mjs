// Runs only in the isolated Firebase demo project, recording actual Android output.
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
if(process.env.GCLOUD_PROJECT!=='demo-orin-auth')throw new Error('Local emulator project required');
const adb=process.env.ORIN_TEST_ADB??'/tmp/orin150-android-runtime/sdk/platform-tools/adb';
const log=createWriteStream('../android-test/instrumentation.log');
function run(args,timeout){return new Promise((resolve,reject)=>{let output='';const task=spawn(adb,args);task.stdout.on('data',data=>{output+=data;log.write(data)});task.stderr.on('data',data=>log.write(data));const timer=setTimeout(()=>{task.kill('SIGTERM');reject(new Error('Android command timed out: '+args.slice(0,3).join(' ')))},timeout);task.on('error',error=>{clearTimeout(timer);reject(error)});task.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('Android command exited '+code));else resolve(output)})})}
try{
 const installed=await run(['shell','pm','path','com.orin.qa'],30000);
 if(!installed.includes('package:'))await run(['install','--no-streaming','-r',fileURLToPath(new URL('../../android-test/qa-source/deliverables/ORIN-Android-1.5.1.apk',import.meta.url))],150000);
 await run(['shell','input','tap','124','458'],30000);
 await run(['shell','am','instrument','-w','-e','plan','plan.json','com.orin.tests/com.orin.tests.OrinInstrumentation'],900000);
 console.log('Android instrumentation finished; inspect per-step assertions in instrumentation.log');
}catch(error){log.write(String(error)+'\n');console.error(error);process.exitCode=1}finally{log.end()}
