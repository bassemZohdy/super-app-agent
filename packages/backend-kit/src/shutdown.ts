/** Drain one local HTTP writer before its process exits. Enable only in executable entrypoints. */
import type { Server,ServerResponse } from 'node:http';
export function shutdownOnSignal(server:Server,cleanup:()=>unknown|Promise<unknown>=()=>{},deadlineMs=70000){
 let stopping=false;const streams=new Set<ServerResponse>();
 server.on('request',(req,res)=>{res.once('finish',()=>{if(stopping)server.closeIdleConnections();});if(req.url?.split('?')[0]==='/api/a2ui/stream'){streams.add(res);res.once('close',()=>streams.delete(res));}});
 const stop=()=>{if(stopping)return;stopping=true;
  // Close SSE and idle keep-alives; allow active business requests to complete their original operation.
  for(const stream of streams)stream.end();
  const timer=setTimeout(()=>{server.closeAllConnections();process.exit(1);},deadlineMs);timer.unref();
  server.close(()=>{void Promise.resolve().then(cleanup).then(()=>process.exit(0),()=>process.exit(1));});server.closeIdleConnections();
 };
 process.once('SIGTERM',stop);process.once('SIGINT',stop);
}
