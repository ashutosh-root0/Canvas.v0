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

//TODODO : Add slug logic in the schema and here

// CREATE USER
app.post("/createuser", async (req, res) => {
  const { email, name, avatar } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: "Email and Name are required" });
  }

  try {
    const user = await prisma.user.create({
      data: {
        email,
        name,
        avatar,
      },
    });
    res.json(user);
  } catch (e: any) {
    // Check for unique constraint violation (P2002 is Prisma's code for duplicate unique fields)
    if (e.code === 'P2002') {
      return res.status(409).json({ error: "A user with this email already exists" });
    }
    console.error(e);
    res.status(500).json({ error: "Failed to create user" });
  }
});

// CREATE CHANNEL: Adds creator as an ADMIN member 
app.post("/createchannel", async (req, res) => {
  const { name, type, userId, partnerId } = req.body;

  try {

    // 1. Handle DIRECT Channel Logic
    if (type === "DIRECT") {
      if (!partnerId) {
        return res.status(400).json({ error: "Partner ID required for Direct Messages" });
      }

      // Check if DM already exists between these two
      const existingChannel = await prisma.channel.findFirst({
        where: {
          type: "DIRECT",
          AND: [
            { members: { some: { userId: userId } } },
            { members: { some: { userId: partnerId } } }
          ]
        },
        // Include members & user info so we can calculate the name
        include: {
          members: {
            include: { user: true }
          }
        }
      });

      if (existingChannel) {
        // Find the partner's User object from the members list
        const partner = existingChannel.members.find(m => m.userId === partnerId)?.user;

        // Solves the Perspective Problem 
        // Return the channel with the computed name
        return res.json({ 
          ...existingChannel, 
          name: partner?.name || "Unknown User" 
        });
      }

      // Create new DM (Leave name as NULL in DB)
      const newDm = await prisma.channel.create({
        data: {
          type: "DIRECT",
          members: {
            create: [
              { user: { connect: { id: userId } }, role: "ADMIN" },
              { user: { connect: { id: partnerId } }, role: "ADMIN" }
            ]
          },
        },
        // Include members to get the names immediately
        include: {
          members: {
            include: { user: true }
          }
        }
      });
      // Calculate name for the response
      const partner = newDm.members.find(m => m.userId === partnerId)?.user;

      return res.json({ 
        ...newDm, 
        name: partner?.name || "Unknown User" 
      });
    }

    // 2. Handle GROUP / PUBLIC Channel Logic
    const newGroup = await prisma.channel.create({
      data: {
        name,
        type,
        members: {
          create: {
            role: "ADMIN",
            user: { connect: { id: userId } } // Connect to the existing User model
          }
        }
      },
    });
    res.json(newGroup);
  } catch (e) {
    res.status(500).json({ error: "Failed to create channel" });
  }
});

// YET TO TEST
// JOIN CHANNEL: Adds a user to an existing PUBLIC or GROUP channel
app.post("/joinchannel", async (req, res) => {
  const { channelId, userId } = req.body;

  if (!channelId || !userId) {
    return res.status(400).json({ error: "Channel ID and User ID are required" });
  }

  try {
    // 1. Check if the channel exists and its type
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
    });

    if (!channel) {
      return res.status(404).json({ error: "Channel not found" });
    }

    // 2. Prevent joining DIRECT channels via this route (those are private)
    if (channel.type === "DIRECT") {
      return res.status(403).json({ error: "Cannot manually join a Direct Message" });
    }

    // 3. Create the membership
    const membership = await prisma.channelMember.create({
      data: {
        channelId,
        userId,
        role: "MEMBER", // Default role for joining
      },
      // Include channel details so frontend can update the UI immediately
      include: {
        channel: true 
      }
    });

    res.json({
      message: "Successfully joined the channel",
      membership
    });

  } catch (e: any) {
    // Unique constraint violations if the user is ALREADY in the channel
    if (e.code === 'P2002') {
      return res.status(409).json({ error: "User is already a member of this channel" });
    }
    
    console.error(e);
    res.status(500).json({ error: "Failed to join channel" });
  }
});

// GET USER CHANNELS: List all channels a user belongs to
app.get('/users/:userId/channels', async (req, res) => {
  const { userId } = req.params;

  try{
    const channels = await prisma.channel.findMany({
      where: {
        members: {
          some: {
            userId: userId
          }
        }
      },
      // We MUST include members to find out who the partner is
      include: {
        members: {
          include: {
            user: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc' // Show newest channels first
      }
    });

    //Transform the data to "Compute" the name
    const computedChannels = channels.map((channel) => {
      
      // LOGIC: If it's a DM, find the OTHER user
      if (channel.type === 'DIRECT') {
        const partner = channel.members.find((member) => member.userId !== userId)?.user;
        
        return {
          ...channel,
          // If partner exists, use their name. If not, fallback to "Unknown"
          name: partner ? partner.name : "Unknown User",
          // Send the partner's avatar here!
          avatar: partner ? partner.avatar : null 
        };
      }

      // If it's a GROUP, just return it as is (it already has a name)
      return channel;
    });

    res.json(computedChannels);

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch channels" });
  }
});

// YET TO TEST
// GET MESSAGES: Latest 50 messages for a specific chat in desc order
app.get('/channels/:channelId/messages', async (req, res) => {
  const { channelId } = req.params;
  const { cursor } = req.query; // For pagination

  try {
    const messages = await prisma.message.findMany({
      where: { channelId },
      take: 50,
      skip: cursor ? 1 : 0, // IF cursor exists, skip the cursor message itself
      cursor: cursor ? { id: cursor as string } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { name: true, avatar: true } } }
    });
    // Return the nextCursor to the frontend so they know what to ask for next
    const nextCursor = messages.length > 0 ? messages[messages.length - 1]?.id : null;

    res.json({
      items: messages,
      nextCursor
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});



app.listen(httpport, () => {
  console.log(`HTTP Server listening on port ${httpport}`);
});
