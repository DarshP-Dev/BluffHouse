// Private process harness; never imported by the application or exposed by HTTP.
// Windows child.kill(SIGTERM) can terminate without running JS signal handlers.
process.on('message',message=>{if(message==='shutdown')process.emit('SIGTERM');});
await import('../../apps/server/dist/index.js');
process.send?.({type:'ready'});
