// Test-process workaround for Node's macOS loopback IP_TOS EINVAL. Never imported by the application.
import { Socket } from 'node:net';
const original=Socket.prototype.setTypeOfService;
if(process.platform==='darwin'&&typeof original==='function'){
  Socket.prototype.setTypeOfService=function(...args){
    try{return original.apply(this,args);}catch(error){if(error.code!=='EINVAL')throw error;return this;}
  };
}
