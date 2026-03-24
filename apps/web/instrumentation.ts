import { Agent, setGlobalDispatcher } from 'undici';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    setGlobalDispatcher(
      new Agent({
        keepAliveTimeout: 4000,      // 4s — well under API Gateway's 60s
        keepAliveMaxTimeout: 4000,   // cap it
        connect: {
          rejectUnauthorized: true,
        },
      })
    );
  }
}
