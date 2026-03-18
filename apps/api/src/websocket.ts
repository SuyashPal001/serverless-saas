import type { APIGatewayProxyWebsocketHandlerV2 } from 'aws-lambda';

export const handler: APIGatewayProxyWebsocketHandlerV2 = async (event) => {
  const routeKey = event.requestContext.routeKey;
  const connectionId = event.requestContext.connectionId;
  
  console.log('WebSocket event:', { routeKey, connectionId });

  switch (routeKey) {
    case '$connect':
      // TODO Step 6c: Validate WS token, store connectionId in Redis
      console.log('Client connected:', connectionId);
      return { statusCode: 200, body: 'Connected' };
      
    case '$disconnect':
      // TODO Step 6c: Remove connectionId from Redis
      console.log('Client disconnected:', connectionId);
      return { statusCode: 200, body: 'Disconnected' };
      
    case '$default':
      // Handle ping/pong or other messages
      console.log('Message received:', event.body);
      return { statusCode: 200, body: 'OK' };
      
    default:
      return { statusCode: 400, body: 'Unknown route' };
  }
};
