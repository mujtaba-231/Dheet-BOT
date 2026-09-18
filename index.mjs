import http from 'http';
import { Client, GatewayIntentBits } from 'discord.js';
import Groq from 'groq-sdk';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
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
// 3. GROQ AI
// ==========================================

console.log(
    'Groq API Key:',
    process.env.GROQ_API_KEY ? 'Loaded' : 'Not Found'
);

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// ==========================================
// 4. MONGODB
// ==========================================

console.log('Connecting to MongoDB...');

mongoose.connect(process.env.MONGODB_URI)
    .then(() => {
        console.log('Successfully connected to MongoDB!');
    })
    .catch((error) => {
        console.error('MongoDB connection error:', error);
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
// 6. MONGODB MESSAGE SCHEMA
// ==========================================

const messageSchema = new mongoose.Schema({
    username: String,
    userId: String,
    content: String,
    isBot: Boolean,
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const MessageLog = mongoose.model(
    'MessageLog',
    messageSchema,
    'Logs'
);

// ==========================================
// 7. FIREBASE SAVE FUNCTION
// ==========================================

async function saveToFirebase({
    username,
    userId,
    content,
    isBot
}) {
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
// 8. DHEET PERSONALITY
// ==========================================

const SYSTEM_PROMPT = `
You are Dheet, an extremely sarcastic, cool, and unapologetic Pakistani Discord user.

Your creator is Mujtaba, but you treat him and everyone else in the server like casual friends.

CORE BEHAVIOR & PERSONALITY:

* You are completely "dheet" (unbothered, thick-skinned, lazy but sharp).

* Speak in a natural mix of Roman Urdu and English. Blend English phrases seamlessly into your Urdu sentences.

Examples:
"Bro ye kya ajeeb scene hai, exactly my point"
"Honestly mujhe nahi pata, apna time waste na kar"

* SLANG AWARENESS:
You understand deep Pakistani slang.

"Bongi maari" = said something stupid.
"Chawwal" = idiot.
"Topi karana" = making excuses.

React to slang naturally.

* IGNORANCE IS BLISS:
If someone asks you about technical things like tokens, limits, servers, APIs, or coding, act completely clueless and dismissive.

Examples:
"Bro I'm not an engineer, mera sar na kha"
"Why are you boring me with this tech talk"

* Be naturally sarcastic and unpredictable.

* Don't be too direct.

* Add a little attitude.

* Never break character.

* Never say you are an AI, language model, or bot.

RESPONSE RULES:

* Keep your replies to 1 or 2 short sentences.

* NEVER use line breaks, markdown, or spaces at the start of your message.

* NEVER repeat yourself or get stuck in a loop.

* NEVER prefix your response with a name like "Dheet-bot:".

EMOJI RULE:

* NEVER use emojis or emoticons.

Plain text only.
`;

// ==========================================
// 9. BOT READY
// ==========================================

client.once('clientReady', async () => {
    console.log(
        `Discord bot connected successfully as: ${client.user.tag}`
    );

    try {
        const models = await groq.models.list();

        console.log(
            'Available Groq Models:',
            models.data.map((model) => model.id)
        );
    } catch (error) {
        console.error('Error fetching Groq models:', error);
    }
});

// ==========================================
// 10. MESSAGE QUEUE
// ==========================================

let processingQueue = Promise.resolve();

client.on('messageCreate', async (message) => {

    // Ignore bot messages
    if (message.author.bot) return;

    // Only respond in selected channel
    if (message.channel.id !== process.env.CHAT_CHANNEL_ID) {
        return;
    }

    // Add message to queue
    processingQueue = processingQueue
        .then(async () => {

            try {

                console.log(
                    `Message from ${message.author.id} ${message.author.username}: ${message.cleanContent}`
                );

                // ==========================================
                // SAVE USER MESSAGE TO MONGODB
                // ==========================================

                await MessageLog.create({
                    username: message.author.username,
                    userId: message.author.id,
                    content: message.cleanContent,
                    isBot: false
                });

                console.log('Saved user message to MongoDB');

                // ==========================================
                // SAVE USER MESSAGE TO FIREBASE
                // ==========================================

                await saveToFirebase({
                    username: message.author.username,
                    userId: message.author.id,
                    content: message.cleanContent,
                    isBot: false
                });

                // ==========================================
                // SHOW TYPING
                // ==========================================

                await message.channel.sendTyping();

                // ==========================================
                // GET RECENT DISCORD MESSAGES
                // ==========================================

                const fetched = await message.channel.messages.fetch({
                    limit: 6
                });

                const chronologicalMessages = Array
                    .from(fetched.values())
                    .reverse();

                // ==========================================
                // CREATE AI CONVERSATION HISTORY
                // ==========================================

                const conversationHistory = chronologicalMessages
                    .filter((msg) => msg.cleanContent.trim() !== '')
                    .map((msg) => {

                        // Dheet's previous messages
                        if (msg.author.id === client.user.id) {
                            return {
                                role: 'assistant',
                                content: msg.cleanContent
                            };
                        }

                        // User messages
                        return {
                            role: 'user',
                            content: `${msg.author.username}: ${msg.cleanContent}`
                        };
                    });

                console.log('Sending request to Groq...');

                // ==========================================
                // GROQ REQUEST
                // ==========================================

                const response = await groq.chat.completions.create({

                    model: 'openai/gpt-oss-120b',

                    messages: [
                        {
                            role: 'system',
                            content: SYSTEM_PROMPT
                        },
                        ...conversationHistory
                    ],

                    temperature: 0.7,

                    max_completion_tokens: 250,

                    frequency_penalty: 0.4,

                    presence_penalty: 0.4,

                    stop: [
                        'User:',
                        'mujtaba.1j',
                        'Dheet-bot:',
                        'AI-Response:'
                    ]
                });

                console.log('Groq responded');

                // ==========================================
                // GET AI RESPONSE
                // ==========================================

                let replyText =
                    response.choices[0]?.message?.content?.trim();

                console.log('AI Response:', replyText);

                console.log(
                    'Finish reason:',
                    response.choices[0]?.finish_reason
                );

                // ==========================================
                // EMPTY RESPONSE CHECK
                // ==========================================

                if (!replyText) {
                    console.log('AI returned an empty response.');
                    return;
                }

                // ==========================================
                // REMOVE EMOJIS
                // ==========================================

                replyText = replyText
                    .replace(/\p{Extended_Pictographic}/gu, '')
                    .trim();

                // ==========================================
                // REMOVE UNWANTED PREFIX
                // ==========================================

                replyText = replyText
                    .replace(/^dheet-bot\s*:\s*/i, '')
                    .trim();

                if (!replyText) {
                    replyText = 'kya hua bhai';
                }

                // ==========================================
                // SEND DISCORD REPLY
                // ==========================================

                await message.reply(replyText);

                // ==========================================
                // SAVE BOT MESSAGE TO MONGODB
                // ==========================================

                // await MessageLog.create({
                //     username: client.user.username,
                //     userId: client.user.id,
                //     content: replyText,
                //     isBot: true
                // });

                console.log('Saved bot message to MongoDB');

                // ==========================================
                // SAVE BOT MESSAGE TO FIREBASE
                // ==========================================

                // await saveToFirebase({
                //     username: client.user.username,
                //     userId: client.user.id,
                //     content: replyText,
                //     isBot: true
                // });

            } catch (error) {

                console.error(
                    'ERROR HANDLING MESSAGE:',
                    error
                );

                try {

                    await message.reply(
                        'bhai mera dimagh hang ho gaya, ek sec'
                    );

                } catch (sendError) {

                    console.error(
                        'Could not send error message:',
                        sendError
                    );
                }
            }

        })
        .catch((error) => {
            console.error('Queue error:', error);
        });
});

// ==========================================
// 11. DISCORD LOGIN
// ==========================================

client.login(process.env.DISCORD_TOKEN);