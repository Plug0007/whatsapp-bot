const { default: makeWASocket, useSingleFileAuthState, DisconnectReason } = require('@adiwajshing/baileys');
const qrcode = require('qrcode-terminal');
const express = require('express');
const { state, saveState } = useSingleFileAuthState('./auth.json');

// Blocklist numbers (with country code, e.g., "+919876543210")
const blocklist = ["+911234567890"];

// Store known users
let knownUsers = new Set();

function startSock() {
    const sock = makeWASocket({ auth: state, printQRInTerminal: true });

    sock.ev.on('creds.update', saveState);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) startSock();
        } else if (connection === 'open') {
            console.log("✅ Bot connected!");
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const senderNumber = m.key.remoteJid.replace(/@s.whatsapp.net/, '');
        const fullNumber = senderNumber.startsWith('+') ? senderNumber : `+${senderNumber}`;

        if (blocklist.includes(fullNumber)) return;

        let reply;
        if (!knownUsers.has(fullNumber)) {
            knownUsers.add(fullNumber);
            reply = "👋 Hi! Welcome to our service. You’re now registered.";
        } else {
            reply = "🙂 Welcome back! How can I help you today?";
        }

        await sock.sendMessage(m.key.remoteJid, { text: reply });
    });
}

startSock();

// Keepalive (for Render)
const app = express();
app.get('/', (req, res) => res.send('WhatsApp Bot is running!'));
app.listen(process.env.PORT || 3000);
