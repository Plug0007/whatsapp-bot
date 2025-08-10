import makeWASocket, { useSingleFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import express from 'express';
import { existsSync, unlinkSync } from 'fs';

const PORT = process.env.PORT || 3000;
const app = express();

// Blocked numbers (country code only, no '+' sign)
const blockedNumbers = ['919876543210', '911234567890'];

// Authentication state stored in this file
const { state, saveState } = useSingleFileAuthState('./auth_info.json');

// Keep track of known users (in-memory, reset on restart)
const knownUsers = new Set();

async function startBot() {
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveState);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      console.log('📱 Scan the QR code above with your WhatsApp.');
    }
    if (connection === 'close') {
      if ((lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut) {
        console.log('🔄 Reconnecting...');
        startBot();
      } else {
        console.log('❌ Logged out. Deleting auth info...');
        if (existsSync('./auth_info.json')) unlinkSync('./auth_info.json');
      }
    }
    if (connection === 'open') {
      console.log('✅ WhatsApp bot connected successfully!');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const sender = msg.key.remoteJid.replace('@s.whatsapp.net', '');

    if (blockedNumbers.includes(sender)) {
      console.log(`🚫 Message from blocked number: ${sender}`);
      return;
    }

    let replyText;
    if (!knownUsers.has(sender)) {
      knownUsers.add(sender);
      replyText = `👋 Hello ${sender}, welcome to the WhatsApp bot!`;
    } else {
      replyText = `🙂 Welcome back, ${sender}! How can I assist you today?`;
    }

    try {
      await sock.sendMessage(msg.key.remoteJid, { text: replyText });
      console.log(`💬 Replied to ${sender}: "${replyText}"`);
    } catch (error) {
      console.error('❌ Failed to send message:', error);
    }
  });
}

// Start Express server to keep Render happy
app.get('/', (req, res) => res.send('WhatsApp Bot is running!'));
app.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  startBot();
});
