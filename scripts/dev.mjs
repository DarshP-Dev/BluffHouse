import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
if(existsSync('.env'))loadEnvFile('.env');
const run=(args,env=process.env)=>spawn(process.execPath,args,{stdio:'inherit',env});
const build=run(['node_modules/typescript/bin/tsc','-p','packages/shared/tsconfig.json']);
build.on('exit',code=>{
  if(code)process.exit(code);
  const children=[
    run(['--env-file-if-exists=.env','--import','tsx','--watch','apps/server/src/index.ts'],{...process.env,PUBLIC_ORIGIN:process.env.PUBLIC_ORIGIN??`http://localhost:${process.env.DEV_PORT??5173}`}),
    run(['node_modules/vite/bin/vite.js','--config','apps/web/vite.config.ts']),
    run(['node_modules/typescript/bin/tsc','-p','packages/shared/tsconfig.json','--watch'])
  ];
  let stopped=false;
  const stop=()=>{if(stopped)return;stopped=true;for(const child of children)child.kill();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);for(const child of children)child.on('exit',stop);
});
