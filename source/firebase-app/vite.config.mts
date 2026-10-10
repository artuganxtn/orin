import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
export default defineConfig({root:import.meta.dirname,resolve:{alias:{'@':resolve(import.meta.dirname,'..')}},plugins:[react()],publicDir:resolve(import.meta.dirname,'../public'),build:{manifest:true,target:'chrome90',outDir:resolve(import.meta.dirname,'../firebase-app-dist'),emptyOutDir:true},server:{host:'0.0.0.0',proxy:{'/api':'http://127.0.0.1:5001/demo-orin-auth/europe-west1/orinApi'}}});
