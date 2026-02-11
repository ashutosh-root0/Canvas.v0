import 'dotenv/config'
import express from "express";
import { prisma } from "@repo/db";


const httpport = 3002;

const app = express();
app.use(express.json());

// Testing Server and Prisma
app.get("/", async (req, res) => {
  console.log("Hello World")
  const user = await prisma.user.findFirst();
  console.log(user);
  res.json({ message: "Hello World" , user });
});

// CREATE CHANNEL: Adds creator as an ADMIN member 
app.post("/channels", async (req, res) => {
  const { name, type, userId } = req.body;
  try {
    const channel = await prisma.channel.create({
      data: {
        name,
        type,
        members: {
          create: { userId, role: "ADMIN" },
        },
      },
    });
    res.json(channel);
  } catch (e) {
    res.status(500).json({ error: "Failed to create channel" });
  }
});

// GET USER CHANNELS: List all channels a user belongs to
app.get('/users/:userId/channels', async (req, res) => {
  const { userId } = req.params;

  try{
    const channels = await prisma.channelMember.findMany({
      where: { userId },
      include: { channel: true }
    });
    res.json(channels);
  }
  catch(e){
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

// GET MESSAGES: Latest 50 messages for a specific chat in desc order
app.get('/channels/:channelId/messages', async (req, res) => {
  const { channelId } = req.params;
  const { cursor } = req.query; // For pagination

  const messages = await prisma.message.findMany({
    where: { channelId },
    take: 50,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor as string } : undefined,
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true, avatar: true } } }
  });
  // What is cursor here?
  res.json(messages);
});

app.listen(httpport, () => {
  console.log(`HTTP Server listening on port ${httpport}`);
});
