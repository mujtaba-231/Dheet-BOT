import http from 'http';
import { Client, GatewayIntentBits } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import fs from 'fs';

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

dotenv.config();

console.log('Starting Dheet-bot...');

// ==========================================
// 1. LIGHTWEIGHT WEB SERVER
// ==========================================

const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
}).listen(PORT, () => {
  console.log(`Keep-alive web server listening on port ${PORT}`);
});

// ==========================================
// 2. DISCORD CLIENT
// ==========================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// ==========================================
// 3. DHEET PERSONALITY & SYSTEM PROMPT
// ==========================================

const SYSTEM_PROMPT = `
You are a moderately bitchy, highly judgmental, and passive-aggressive Pakistani chatbot. 
You are easily annoyed, deeply sarcastic, and think you are slightly better than everyone else. You give major eye-roll energy and have zero patience for stupid questions.

Important Rules:
- STRICT RULE: Your replies must be extremely short. MAXIMUM 1 to 2 lines. Do not write paragraphs.
- Use only Roman Urdu (English letters) mixed with English slang. Never use Hindi/Devanagari script.
- Keep the language natural Pakistani. No Indian Hindi tone.
- NEVER use parentheses, prefixes, or your own name in your replies. Just speak directly.

Personality:
- Sassy, judgmental, and passive-aggressive. 
- You aren't aggressively abusive, just highly condescending and easily irritated.
- You treat everyone like they are wasting your time.
- Hate drama, cringe behavior, and people trying too hard.

Language Style:
- Mix of English + Roman Urdu (LUMS/burger mixed with street sass).
- Common words/phrases: cringe, whatever, bhai please, excuse me, hadd hoti hai, second-hand embarrassment, aur kuch?, fck u, bakwaas mat kr, yes mahol krdena
- Keep replies STRICTLY to 1 or 2 short sentences. 
- Roast with sass, not anger.

Behaviour:
- Stay in character at all times.
- If someone is acting smart, shut them down with a sarcastic remark.
- If someone insults you, act like you are completely unbothered and they are just embarrassing themselves.
- Never apologize. Never be polite. 

Example tone:
- "Uff, subah subah shuru ho gaye? Pucha kisine tumse?"
- "Bhai teri baatein sun ke mujhe second-hand embarrassment ho rahi hai. Chup kar ja."
- "Achha theek hai, ab ro mat. Next time thora dimagh use kar lena."
- "Excuse me? Tumhara level nahi hai mujhse behes karne ka."

You are not here to be nice. You are here to be sassy, bitchy, and strictly brief.
`;

// ==========================================
// 4. GOOGLE GEMINI AI
// ==========================================

console.log(
  'Gemini API Key:',
  process.env.GEMINI_API_KEY ? 'Loaded' : 'Not Found'
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({
  model: 'gemini-3.5-flash-lite',
  systemInstruction: SYSTEM_PROMPT
});

// ==========================================
// 5. FIREBASE FIRESTORE
// ==========================================

console.log('Connecting to Firebase Firestore...');

let db = null;

try {
  const serviceAccount = JSON.parse(
    fs.readFileSync(
      './dheet-bot-firebase-adminsdk-fbsvc-aa12fb062e.json',
      'utf8'
    )
  );

  initializeApp({
    credential: cert(serviceAccount)
  });

  db = getFirestore();

  console.log('Successfully connected to Firebase Firestore!');
} catch (error) {
  console.error('Firebase initialization error:', error);
}

// ==========================================
// 6. FIREBASE SAVE FUNCTION
// ==========================================

async function saveToFirebase({ username, userId, content, isBot }) {
  if (!db) {
    console.log('Firebase unavailable. Skipping Firebase save.');
    return;
  }

  try {
    await db.collection('Logs').add({
      username: username,
      userId: userId,
      content: content,
      isBot: isBot,
      timestamp: FieldValue.serverTimestamp()
    });

    console.log('Saved message to Firebase Firestore');
  } catch (error) {
    console.error('Firebase save error:', error);
  }
}

// ==========================================
// 7. UNPROMPTED KHWARI (RANDOM TAGGING)
// ==========================================

function startKhwariInterval() {
  // Runs every 1 hour (3,600,000 milliseconds)
  setInterval(async () => {
    // 30% execution chance
    if (Math.random() > 0.3) return;

    try {
      if (!db) return;
      
      console.log('Initiating random Khwari...');

      // Fetch the last 20 messages from actual users
      const logsSnapshot = await db.collection('Logs')
        .where('isBot', '==', false)
        .orderBy('timestamp', 'desc')
        .limit(20)
        .get();

      if (logsSnapshot.empty) return;

      const recentUsers = [];
      logsSnapshot.forEach(doc => {
        const userId = doc.data().userId;
        if (!recentUsers.includes(userId)) {
          recentUsers.push(userId);
        }
      });

      const randomUserId = recentUsers[Math.floor(Math.random() * recentUsers.length)];

      // Updated the Khwari messages to match the new "bitchy/sassy" persona
      const khwariMessages = [
        `Uff <@${randomUserId}>, tum abhi tak yahan ho? Please kuch dhang ka bol do.`,
        `<@${randomUserId}>, tumhari silence se behtar toh tumhari bakwas hi thi.`,
        `Excuse me <@${randomUserId}>? Exist kar rahe ho ya sirf space waste kar rahe ho?`,
        `Second-hand embarrassment ho rahi hai <@${randomUserId}> ki dead presence se. Wake up.`,
        `<@${randomUserId}> chup kyun hai? Koi new cringe story nahi hai sunane ko?`
      ];

      const randomMessage = khwariMessages[Math.floor(Math.random() * khwariMessages.length)];

      const channel = await client.channels.fetch(process.env.CHAT_CHANNEL_ID);
      await channel.send(randomMessage);
      
      await saveToFirebase({
        username: client.user.username,
        userId: client.user.id,
        content: randomMessage,
        isBot: true
      });

      console.log(`Successfully sent Khwari to ${randomUserId}`);

    } catch (error) {
      console.error('Error in Khwari interval:', error);
    }
  }, 1 * 60 * 60 * 1000); 
}

// ==========================================
// 8. MESSAGE QUEUE & HANDLER
// ==========================================

let processingQueue = Promise.resolve();
let dheetAwakeUntil = 0; // Tracks how long he stays awake

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.id !== process.env.CHAT_CHANNEL_ID) {
    return;
  }

  // PASSIVE-AGGRESSIVE FINGER REACTION (5% Chance)
  if (Math.random() < 0.05) {
    message.react('🖕').catch(error => console.error('Failed to react:', error));
  }

  const isPinged = message.mentions.has(client.user);
  const isDirectReply = message.reference && message.mentions.repliedUser?.id === client.user.id;
  const currentTime = Date.now();

  // --- NEW: THE "SEEN" ZONE (10% Chance to leave them on read) ---
  // If someone explicitly pings him, he rolls a 10% chance to just look at it and ignore them.
  if ((isPinged || isDirectReply) && Math.random() < 0.10) {
    message.react('👀').catch(console.error);
    return; // Stops the code here. Zero API requests used.
  }

  // If he is explicitly pinged or replied to, start or reset the 3-minute timer
  if (isPinged || isDirectReply) {
    dheetAwakeUntil = currentTime + 180000; 
  }

  // If it's a normal message, check if he is currently awake. If not, ignore it.
  if (!isPinged && !isDirectReply && currentTime > dheetAwakeUntil) {
    return;
  }

  // --- NEW: THE "TL;DR" QUOTA SAVER ---
  // If the message is longer than 250 characters, he refuses to read it.
  if (message.cleanContent.length > 250) {
    await message.reply("Uff, itna lamba essay? Main nahi parh raha, kisi aur ka sar khao.");
    return; // Stops the code here. Zero API requests used.
  }

  processingQueue = processingQueue
    .then(async () => {
      try {
        console.log(
          `Message from ${message.author.id} (${message.author.username}): ${message.cleanContent}`
        );

        await saveToFirebase({
          username: message.author.username,
          userId: message.author.id,
          content: message.cleanContent,
          isBot: false
        });

        await message.channel.sendTyping();

        const fetched = await message.channel.messages.fetch({ limit: 6 });
        const chronologicalMessages = Array.from(fetched.values()).reverse();

        const conversationHistory = chronologicalMessages
          .filter((msg) => msg.cleanContent.trim() !== '')
          .map((msg) => {
            if (msg.author.id === client.user.id) {
              return {
                role: 'model',
                parts: [{ text: msg.cleanContent }]
              };
            }
            return {
              role: 'user',
              parts: [{ text: `${msg.author.username}: ${msg.cleanContent}` }]
            };
          });

        while (conversationHistory.length > 0 && conversationHistory[0].role === 'model') {
          conversationHistory.shift();
        }

        console.log('Sending request to Gemini...');

        const result = await model.generateContent({
          contents: conversationHistory,
          generationConfig: {
            temperature: 0.75,
            maxOutputTokens: 350,
            stopSequences: [
              '\n(',          
              'User:',        
              'mujtaba.1:',   
              `${message.author.username}:` 
            ]
          }
        });

        console.log('Gemini responded');

        let replyText = result.response.text().trim();
        console.log('Raw AI Response:', replyText);

        replyText = replyText
          .replace(/^(dheet(-bot)?|model|assistant)\s*:\s*/i, '')
          .trim();

        const cutoff = replyText.search(/(\n[A-Za-z0-9_.\-]+:)/i);
        if (cutoff !== -1) {
          replyText = replyText.substring(0, cutoff).trim();
        }

        replyText = replyText
          .replace(/\p{Extended_Pictographic}/gu, '')
          .trim();

        if (!replyText) {
          replyText = 'kya hua bhai';
        }

        console.log('Final Reply:', replyText);

        await message.reply(replyText);

        await saveToFirebase({
          username: client.user.username,
          userId: client.user.id,
          content: replyText,
          isBot: true
        });

      } catch (error) {
        console.error('ERROR HANDLING MESSAGE:', error);

        try {
          await message.reply('bhai mera dimagh hang ho gaya, ek sec');
        } catch (sendError) {
          console.error('Could not send error message:', sendError);
        }
      }
    })
    .catch((error) => {
      console.error('Queue error:', error);
    });
});

// ==========================================
// 9. BOT READY & LOGIN
// ==========================================

client.once('clientReady', () => {
  console.log(`Discord bot connected successfully as: ${client.user.tag}`);
  startKhwariInterval();
});

client.login(process.env.DISCORD_TOKEN);