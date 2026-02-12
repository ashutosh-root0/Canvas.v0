import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { prisma } from '@repo/db';

const wss = new WebSocketServer({ port: 8080 });

// Global map to track user connections (supports multiple devices per user)
const userConnections = new Map<string, Set<WebSocket>>();
console.log(userConnections);

/**
 * Handles the logic for sending a message:
 * 1. Validates channel membership
 * 2. Saves to DB
 * 3. Broadcasts to all channel members
 */

async function handleSendMessage(
  currentUserId: string, 
  payload: any, 
  ws: WebSocket
) {
  const { channelId, content } = payload;

  try {
    // 1. Validate Membership (Security Check)
    // Ensure the user is actually a member of this channel

    const isMember = await prisma.channelMember.findUnique({
      where: {
        channelId_userId: {
          channelId,
          userId: currentUserId
        }
      }
    });

    if (!isMember) {
       ws.send(JSON.stringify({ type: 'ERROR', message: 'You are not a member of this channel' }));
       return;
    }

    // 2. Save to DB
    const dbMessage = await prisma.message.create({
      data: { 
        content, 
        channelId, 
        userId: currentUserId 
      },
      include: {
        user: { select: { name: true, avatar: true } },
        channel: { select: { members: { select: { userId: true } } } }
      }
    });

    // 3. Broadcast to all members
    const members = dbMessage.channel.members;
    
    const outgoingMessage = JSON.stringify({
      type: 'NEW_MESSAGE',
      payload: {
        id: dbMessage.id,
        content: dbMessage.content,
        channelId: dbMessage.channelId,
        userId: dbMessage.userId,
        createdAt: dbMessage.createdAt,
        user: dbMessage.user
      }
    });

    // Send to every device of every member
    members.forEach((member) => {
      const memberSockets = userConnections.get(member.userId);
      
      if (memberSockets) {
        memberSockets.forEach((socket) => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(outgoingMessage);
          }
        });
      }
    });

  } catch (error) {
    console.error("Failed to send message:", error);
    ws.send(JSON.stringify({ type: 'ERROR', message: 'Database error' }));
  }
}

// Main Connection Listener
wss.on('connection', async function connection(ws) {
  console.log('Client connected');
  console.log(userConnections);

  // Track the user for this specific socket connection
  let currentUserId: string | null = null;

  ws.on('error', console.error);

  ws.on('message', async function message(data) {
    console.log('received: %s', data);

    try {
      const parsedData = JSON.parse(data.toString());

      switch (parsedData.type) {

case 'IDENTIFY': {
          const { userId } = parsedData.payload;
          
          // 1. Basic format check
          if (!userId) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'User ID is required' }));
            return; 
          }

          // 2. SECURITY CHECK: Does this user actually exist in our DB?
          const userExists = await prisma.user.findUnique({
            where: { id: userId }
          });

          if (!userExists) {
            console.log(`Connection rejected: User ${userId} does not exist.`);
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Invalid User ID' }));
            ws.close(); // Kick them out immediately
            return;
          }

          // 3. If valid, proceed with connection logic
          currentUserId = userId;

          if (!userConnections.has(userId)) {
            userConnections.set(userId, new Set());
          }
          userConnections.get(userId)?.add(ws);
          
          console.log(`User ${userId} connected. Total devices: ${userConnections.get(userId)?.size}`);
          
          // Optional: Send a confirmation back to the client
          ws.send(JSON.stringify({ type: 'SUCCESS', message: 'Connected successfully' }));
          break;
        }

        case 'SEND_MESSAGE': {
          if (!currentUserId) {
            ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthenticated' }));
            return;
          }
          
          // Delegate to the helper function
          await handleSendMessage(currentUserId, parsedData.payload, ws);
          break;
        }

        case 'HEARTBEAT':
          ws.send(JSON.stringify({ type: 'Alive' }));
          break;
      }
    } catch (err) {
      console.error("Error handling message:", err);
    }
  });

  // CLEANUP: Remove only this specific socket on disconnect
  ws.on('close', () => {
    if (currentUserId) {
      const userSockets = userConnections.get(currentUserId);
      if (userSockets) {
        userSockets.delete(ws); // Remove this specific tab/device
        
        if (userSockets.size === 0) {
          userConnections.delete(currentUserId); // Clean up map if no devices left
          console.log(`User ${currentUserId} went offline.`);
        }
      }
    }
  });
});