import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '@repo/db';

const wss = new WebSocketServer({ port: 8080 });

const userConnections = new Map<string, WebSocket>();

// First saves to DB and then broadcasts
async function handleSendMessage(payload: any) {
  const { channelId, content, userId } = payload;

  // Save to DB
  const dbMessage = await prisma.message.create({
    data: { content, channelId, userId },
    include: { 
      user: { select: { name: true, avatar: true } },
      channel: { include: { members: { select: { userId: true } } } }
    }
  });

  // Broadcast
  const channelMembers = dbMessage.channel.members;
  channelMembers.forEach((member) => {
    const recipientSocket = userConnections.get(member.userId);
    
    if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
      recipientSocket.send(JSON.stringify({
        type: 'NEW_MESSAGE',
        payload: {
          id: dbMessage.id,
          content: dbMessage.content,
          channelId: dbMessage.channelId,
          userId: dbMessage.userId,
          createdAt: dbMessage.createdAt,
          user: dbMessage.user
        }
      }));
    }
  });
}

// 2. Main Connection Listener
wss.on('connection', async function connection(ws) {
  console.log('Client connected');
  ws.on('error', console.error);

  let currentUserId: string | null = null;

  ws.on('message', async function message(data) {
    console.log('received: %s', data);

    try {
      const parsedData = JSON.parse(data.toString());

      switch (parsedData.type) {
        case 'IDENTIFY':
          currentUserId = parsedData.payload.userId;
          if (currentUserId) {
            userConnections.set(currentUserId, ws);
            console.log(`User ${currentUserId} is globally online.`);
          }
          break;

        case 'SEND_MESSAGE':
          // We call our extracted async function
          await handleSendMessage(parsedData.payload);
          break;
          
        case 'HEARTBEAT':
          ws.send(JSON.stringify({ type: 'Alive' }));
          break;
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });

  // Cleanup on disconnect
  ws.on('close', () => {
    if (currentUserId) {
      userConnections.delete(currentUserId);
    }
  });
});