import { Agent, setGlobalDispatcher } from 'undici';

console.log('Registering Undici global dispatcher for Node.js runtime...');

setGlobalDispatcher(
  new Agent({
    keepAliveTimeout: 4000,
    keepAliveMaxTimeout: 4000,
  })
);
