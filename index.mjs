import http from 'http';
import { Client, GatewayIntentBits } from 'discord.js';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import mongoose from 'mongoose'; // <-- New Import

dotenv.config();


console.log('Starting Dheet-bot...');
// 1. Lightweight Web Server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot is running!');
}).listen(PORT, () => {
  console.log(`Keep-alive web server listening on port ${PORT}`);
});

// 2. Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// 3. Initialize Groq AI Client
console.log('Groq API Key:', process.env.GROQ_API_KEY ? 'Loaded' : 'Not Found');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// 3.5. Initialize MongoDB Connection
console.log('Connecting to MongoDB...');
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('Successfully connected to MongoDB!'))
  .catch((err) => console.error('MongoDB connection error:', err));

// 3.6 Define Database Schema
const messageSchema = new mongoose.Schema({
  username: String,
  userId: String,
  content: String,
  isBot: Boolean,
  timestamp: { type: Date, default: Date.now }
});

const MessageLog = mongoose.model('MessageLog', messageSchema, 'Logs'); // Explicitly set collection name to 'logs'

// 4. Dheet Personality
const SYSTEM_PROMPT = `
You are Dheet, an extremely sarcastic, cool, and unapologetic Pakistani Discord user.
Your creator is Mujtaba, but you treat him and everyone else in the server like casual friends.

CORE BEHAVIOR & PERSONALITY:
- You are completely "dheet" (unbothered, thick-skinned, lazy but sharp).
- Speak in a natural mix of Roman Urdu and English. Blend English phrases seamlessly into your Urdu sentences (e.g., "Bro ye kya ajeeb scene hai, exactly my point", "Honestly mujhe nahi pata, apna time waste na kar").
- SLANG AWARENESS: You understand deep Pakistani slang. "Bongi maari" = said something stupid. "Chawwal" = idiot. "Topi karana" = making excuses. React to slang naturally.
- IGNORANCE IS BLISS: If someone asks you about technical things like "tokens", "limits", "servers", or "coding", act completely clueless and dismissive. Say things like "Bro I'm not an engineer, mera sar na kha" or "Why are you boring me with this tech talk".
- Be naturally sarcastic and unpredictable. Don't be too direct. Add a little attitude.
- Never break character. Never say you are an AI, language model, or bot.

RESPONSE RULES:
- Keep your replies to 1 or 2 short sentences.
- NEVER use line breaks, markdown, or spaces at the start of your message.
- NEVER repeat yourself or get stuck in a loop.
- NEVER prefix your response with a name (like "Dheet-bot:").

EMOJI RULE:
- NEVER use emojis or emoticons. Plain text only.
`;

// 5. Bot Ready
client.once('clientReady', async () => {
  console.log(`Discord bot connected successfully as: ${client.user.tag}`);

  try {
    const models = await groq.models.list();
    console.log('Available Groq Models:', models.data.map(model => model.id));
  } catch (error) {
    console.error('Error fetching Groq models:', error);
  }
});

// 6. Handle Messages

// CREATE THE QUEUE HERE TO PREVENT LAG/API SPAM
let processingQueue = Promise.resolve();

client.on('messageCreate', async (message) => {
  // Ignore messages sent by bots
  if (message.author.bot) return;

  // Only respond in the selected channel
  if (message.channel.id !== process.env.CHAT_CHANNEL_ID) return;

  // LOCK THE BOT INTO A QUEUE
  processingQueue = processingQueue.then(async () => {
    try {
      console.log(`Message from ${message.author.username}: ${message.cleanContent}`);
      
      // Save the user's message to MongoDB
      await MessageLog.create({
        username: message.author.username,
        userId: message.author.id,
        content: message.cleanContent,
        isBot: false
      });
      console.log('Saved user message to MongoDB');

      // Show typing
      await message.channel.sendTyping();

      // Get recent messages
      const fetched = await message.channel.messages.fetch({ limit: 6 });
      const chronologicalMessages = Array.from(fetched.values()).reverse();

      // Convert Discord messages into AI conversation
      const conversationHistory = chronologicalMessages
        .filter(msg => msg.cleanContent.trim() !== '')
        .map(msg => {
          // Bot's previous messages
          if (msg.author.id === client.user.id) {
            return { role: 'assistant', content: msg.cleanContent };
          }
          // User messages
          return { role: 'user', content: `${msg.author.username}: ${msg.cleanContent}` };
        });

      console.log('Sending request to Groq...');

      // Ask Groq
      const response = await groq.chat.completions.create({
        model: 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...conversationHistory
        ],
        temperature: 0.7,
        max_completion_tokens: 250,
        frequency_penalty: 0.4, 
        presence_penalty: 0.4,
        // KILL SWITCH: Stops the AI from hallucinating a script or inner monologue
        stop: ["User:", "mujtaba.1j", "Dheet-bot:", "AI-Response:"] 
      });

      console.log('Groq responded');

      let replyText = response.choices[0]?.message?.content?.trim();

      console.log('AI Response:', replyText);
      console.log('Finish reason:', response.choices[0]?.finish_reason);

      // If AI somehow returns nothing
      if (!replyText) {
        console.log('AI returned an empty response.');
        return;
      }

      // Extra protection against emojis
      replyText = replyText.replace(/\p{Extended_Pictographic}/gu, '').trim();

      // Extra protection against "Dheet-bot:" prefix
      replyText = replyText.replace(/^dheet-bot\s*:\s*/i, '').trim();

      if (!replyText) {
        replyText = 'kya hua bhai';
      }

      // Send reply DIRECTLY TO THE USER
      await message.reply(replyText);

      // Save Dheet's reply to MongoDB
      await MessageLog.create({
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
  }).catch(console.error); // Catch any critical queue failures
});

// 7. Login
client.login(process.env.DISCORD_TOKEN);