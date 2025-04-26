require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const puppeteer = require('puppeteer');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

const app = express();
const port = process.env.PORT || 3000;
const queue = [];
const maxSlots = 10;
const cooldowns = new Map();

// Web server
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(port, () => console.log(`Web server listening on port ${port}`));

// Message handler (ONLY ONE)
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Cooldown system
    if (!cooldowns.has(message.author.id)) {
        cooldowns.set(message.author.id, new Map());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(message.author.id);
    const cooldownAmount = 2000;

    if (timestamps.has(message.content)) {
        const expirationTime = timestamps.get(message.content) + cooldownAmount;
        if (now < expirationTime) {
            return message.reply(`Please wait ${((expirationTime - now) / 1000).toFixed(1)} more seconds before using this command again.`)
                .then(msg => setTimeout(() => msg.delete(), 3000));
        }
    }

    timestamps.set(message.content, now);
    setTimeout(() => timestamps.delete(message.content), cooldownAmount);

    // Command router
    switch (true) {
        case message.content === '!q':
            return handleQueueJoin(message);
        case message.content === '!start':
            return handleGameStart(message);
        case message.content === '!del':
            return handleQueueLeave(message);
        case message.content === '!rg':
            return sendQueueEmbed(message);
        case message.content.startsWith('!add'):
            return handleAddPlayer(message);
        case message.content.startsWith('!remove'):
            return handleRemovePlayer(message);
    }
});

// Command handlers
async function handleQueueJoin(message) {
    if (queue.some(p => p.id === message.author.id)) {
        return message.channel.send(`${message.author}, you're already in queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    if (queue.length >= maxSlots) {
        const pingMessage = queue.map(p => `<@${p.id}>`).join(' ');
        await message.channel.send(`Queue full! Playing:\n${pingMessage}`);
        queue.length = 0;
        return;
    }

    queue.push({ id: message.author.id, joinTime: Date.now() });
    await sendQueueEmbed(message);
}

async function handleGameStart(message) {
    if (queue.length === 0) {
        return message.channel.send("Queue is empty!")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    let resultMessage = 'Game ready!\n';
    for (const player of queue) {
        try {
            const elo = await fetchElo(player.id);
            resultMessage += `<@${player.id}> (ELO: ${elo || 'N/A'})\n`;
        } catch {
            resultMessage += `<@${player.id}> (ELO: Unavailable)\n`;
        }
    }

    await message.channel.send(resultMessage);
    queue.length = 0;
    await message.delete().catch(console.error);
}

async function handleQueueLeave(message) {
    const index = queue.findIndex(p => p.id === message.author.id);
    if (index === -1) {
        return message.channel.send(`${message.author}, you're not in queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    queue.splice(index, 1);
    await sendQueueEmbed(message);
}

async function handleAddPlayer(message) {
    const user = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);
    if (!user) {
        return message.channel.send("Please mention a user!")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    if (queue.some(p => p.id === user.id)) {
        return message.channel.send(`${user} is already in queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    if (queue.length >= maxSlots) {
        return message.channel.send(`Queue is full (${maxSlots} max)!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    queue.push({ id: user.id, joinTime: Date.now() });
    await message.channel.send(`${user} was added to queue!`);
    await sendQueueEmbed(message);
}

async function handleRemovePlayer(message) {
    const user = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);
    if (!user) {
        return message.channel.send("Please mention a user!")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    const index = queue.findIndex(p => p.id === user.id);
    if (index === -1) {
        return message.channel.send(`${user} isn't in queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    queue.splice(index, 1);
    await message.channel.send(`${user} was removed from queue!`);
    await sendQueueEmbed(message);
}

// ELO Fetcher (Simplified)
async function fetchElo(playerId) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto(`https://stats.firstbloodgaming.com/player/${playerId}`, {
            waitUntil: 'networkidle2',
            timeout: 30000
        });

        const content = await page.content();
        const match = content.match(/ELO Score:\s*(\d+)/i);
        return match ? match[1] : null;
    } finally {
        if (browser) await browser.close().catch(console.error);
    }
}

// Queue display
async function sendQueueEmbed(message, title = "Current Queue") {
    const team1 = queue.slice(0, 5).map((p, i) => 
        `${(i + 1).toString().padStart(2, '0')}. <@${p.id}> (${formatQueueTime(p.joinTime)})` || 'Empty'
    );
    
    const team2 = queue.slice(5).map((p, i) => 
        `${(i + 6).toString().padStart(2, '0')}. <@${p.id}> (${formatQueueTime(p.joinTime)})` || 'Empty'
    );

    const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(title)
        .addFields(
            { name: 'Team 1', value: team1.join('\n') || 'Empty', inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Team 2', value: team2.join('\n') || 'Empty', inline: true }
        )
        .setFooter({ text: `${queue.length}/${maxSlots} players` });

    await message.channel.send({ embeds: [embed] });
}

function formatQueueTime(joinTime) {
    const minutes = Math.floor((Date.now() - joinTime) / 60000);
    return `${minutes}m`;
}

client.login(process.env.DISCORD_TOKEN);