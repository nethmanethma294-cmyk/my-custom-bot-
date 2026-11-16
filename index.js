const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage } = require('@whiskeysockets/baileys')
const pino = require('pino')
const fs = require('fs')

async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('session_auth')
    
    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if(connection === 'close') {
            const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut
            if(shouldReconnect) connectToWhatsApp()
        } else if(connection === 'open') {
            console.log('Dark Bunny Bot සාර්ථකව සම්බන්ධ වුණා!')
        }
    })

    sock.ev.on('messages.upsert', async m => {
        const msg = m.messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const isGroup = from.endsWith('@g.us')
        const sender = msg.key.participant || msg.key.remoteJid
        
        // මැසේජ් එකේ තියෙන Text එක හඳුනාගැනීම
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""

        // ==========================================
        // 🚨 VIEW ONCE (ONE-TIME PHOTO/VIDEO) BYPASS FEATURE
        // ==========================================
        const msgType = Object.keys(msg.message)[0]
        let isViewOnce = false
        let viewOnceMessage = null

        if (msgType === 'viewOnceMessage' || msgType === 'viewOnceMessageV2') {
            isViewOnce = true
            viewOnceMessage = msg.message[msgType].message
        }

        if (isViewOnce && viewOnceMessage) {
            try {
                const mediaType = Object.keys(viewOnceMessage)[0] // imageMessage හෝ videoMessage
                const mediaContent = viewOnceMessage[mediaType]
                
                // මීඩියා එක ඩවුන්ලෝඩ් කරගැනීම
                const stream = await downloadContentFromMessage(mediaContent, mediaType === 'imageMessage' ? 'image' : 'video')
                let buffer = Buffer.from([])
                for await(const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk])
                }

                let captionText = `*🐰 DARK BUNNY VIEW-ONCE BYPASS 🐰*\n\n` +
                                  `👤 *Ewwe:* @${sender.split('@')[0]}\n` +
                                  `💬 *Caption:* ${mediaContent.caption || 'No Caption'}\n\n` +
                                  `_Saved Automatically!_`

                // බොට්ව පාවිච්චි කරන කෙනාගේ පුද්ගලික Chat එකට (Inbox) හෝ ඒ ආපු Chat එකටම මේක යැවීම
                if (mediaType === 'imageMessage') {
                    await sock.sendMessage(sock.user.id.split(':')[0] + '@s.whatsapp.net', { image: buffer, caption: captionText, mentions: [sender] })
                } else if (mediaType === 'videoMessage') {
                    await sock.sendMessage(sock.user.id.split(':')[0] + '@s.whatsapp.net', { video: buffer, caption: captionText, mentions: [sender] })
                }
            } catch (e) {
                console.log("View once download error: ", e)
            }
        }

        // ==========================================
        // 🛠️ COMMANDS LIST
        // ==========================================
        
        // 1. MENU COMMAND
        if (text === '.menu' || text === 'Menu') {
            let myMenu = `*🐰 DARK BUNNY WHATSAPP BOT 🐰*\n\n` +
                         `👋 සාදරයෙන් පිළිගනිමු! මම Dark Bunny ව්‍යාපාරික බොට් පද්ධතියයි.\n\n` +
                         `*🛡️ AUTOMATION FEATURES:*\n` +
                         `✅ One-Time Photos/Videos Saving (Auto)\n\n` +
                         `*⚙️ UTILITY COMMANDS:*\n` +
                         `🔹 .alive - බොට් ඔන්ලයින්ද බැලීමට\n` +
                         `🔹 .jid - චැට් එකේ JID අංකය ලබාගැනීමට\n` +
                         `🔹 .getdp - ප්‍රොෆයිල් පින්තූරය ලබාගැනීමට\n\n` +
                         `*👥 GROUP COMMANDS:*\n` +
                         `🔹 .kick - ගෲප් එකෙන් කෙනෙක් අයින් කිරීමට\n\n` +
                         `*🏪 BUSINESS COMMANDS:*\n` +
                         `🔹 .info | .price | .bank\n\n` +
                         `_Powered by Dark Bunny_`
            await sock.sendMessage(from, { text: myMenu })
        }

        // 2. ALIVE COMMAND
        if (text === '.alive') {
            await sock.sendMessage(from, { text: '*🐰 Dark Bunny Bot සාර්ථකව ක්‍රියාත්මකයි! (Alive)*' })
        }

        // 3. JID COMMAND
        if (text === '.jid') {
            await sock.sendMessage(from, { text: `*🎯 මේ චැට් එකේ JID එක:* ${from}` })
        }

        // 4. GETDP COMMAND
        if (text === '.getdp') {
            try {
                let target = msg.message.extendedTextMessage?.contextInfo?.participant || from
                const ppUrl = await sock.profilePictureUrl(target, 'image')
                await sock.sendMessage(from, { image: { url: ppUrl }, caption: '*🐰 මෙන්න Profile Photo එක!*' })
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ ප්‍රොෆයිල් පින්තූරය ලබාගත නොහැකි විය.' })
            }
        }

        // 5. KICK COMMAND
        if (text.startsWith('.kick') && isGroup) {
            try {
                let userToKick = msg.message.extendedTextMessage?.contextInfo?.participant
                if (!userToKick) return await sock.sendMessage(from, { text: '❌ කරුණාකර අයින් කිරීමට අවශ්‍ය කෙනාගේ මැසේජ් එකකට `.kick` ලෙස රිප්ලයි කරන්න.' })
                await sock.groupParticipantsUpdate(from, [userToKick], 'remove')
                await sock.sendMessage(from, { text: '✅ සාර්ථකව ගෲප් එකෙන් ඉවත් කරන ලදී!' })
            } catch (e) {
                await sock.sendMessage(from, { text: '❌ මට ඇඩ්මින් බලය නැත.' })
            }
        }

        // BUSINESS COMMANDS
        if (text === '.info') await sock.sendMessage(from, { text: '🏢 *DARK BUNNY OFFICIAL*\n\nඅපගේ ආයතනය පැය 24 පුරාම විවෘතව පවතී.' })
        if (text === '.price') await sock.sendMessage(from, { text: '📦 *භාණ්ඩ මිල ගණන්:*\n\n1. භාණ්ඩය A - රු. 1500\n2. භාණ්ඩය B - රු. 2500' })
        if (text === '.bank') await sock.sendMessage(from, { text: '💳 *බැංකු විස්තර:*\n\nBank: BOC\nAccount Name: Dark Bunny' })
    })
}

connectToWhatsApp()
