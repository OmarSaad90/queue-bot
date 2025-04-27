console.log(`✅ Bot is starting fresh at ${new Date().toISOString()}`);

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

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(port, () => {
    console.log(`Web server is listening on port ${port}`);
});

const queue = [];
// Hardcoded mapping: Discord ID -> FirstbloodGaming Profile ID
const playerProfiles = {
    "266263595346558976": "hellhound",
    "288476136210694146": "chrisbeaman",
    // Add more mappings here
};

const maxSlots = 10;
const cooldowns = new Map();

// SINGLE messageCreate listener
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Cooldown system to prevent duplicate processing
    if (!cooldowns.has(message.author.id)) {
        cooldowns.set(message.author.id, new Map());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(message.author.id);
    const cooldownAmount = 2000;

    if (timestamps.has(message.content)) {
        const expirationTime = timestamps.get(message.content) + cooldownAmount;
        if (now < expirationTime) return;
    }

    timestamps.set(message.content, now);
    setTimeout(() => timestamps.delete(message.content), cooldownAmount);

    // Command router
    try {
        if (message.content === '!q') return await handleQueueJoin(message);
        if (message.content === '!start') return await handleGameStart(message);
        if (message.content === '!del') return await handleQueueLeave(message);
        if (message.content === '!rg') return await sendQueueEmbed(message);
        if (message.content.startsWith('!add')) return await handleAddPlayer(message);
        if (message.content.startsWith('!remove')) return await handleRemovePlayer(message);
    } catch (error) {
        console.error('Command error:', error);
    }
});

// Command handlers
async function handleQueueJoin(message) {
    if (queue.some(player => player.id === message.author.id)) {
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
        } catch (error) {
            console.error(`ELO fetch error for ${player.id}:`, error);
            resultMessage += `<@${player.id}> (ELO: Error)\n`;
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

// Improved ELO fetcher
async function fetchElo(playerId) {
    let browser;
    try {
        const playerProfile = playerProfiles[playerId];
        if (!playerProfile) {
            throw new Error(`No profile mapping for playerId ${playerId}`);
        }

        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        await page.goto(`https://stats.firstbloodgaming.com/player/${playerProfile}`, { waitUntil: 'networkidle2' });

        const debug = await page.evaluate(() => {
            const tables = document.querySelectorAll('.column article table');
            return Array.from(tables).map(table => table.innerText.trim());
        });

        console.log("Fetched tables for player:", playerProfile, debug);  // <<--- ADD THIS

        const eloScore = await page.evaluate(() => {
            const tables = document.querySelectorAll('.column article table');
            if (tables.length >= 2) {
                const secondTable = tables[1];
                const rows = secondTable.querySelectorAll('tr');
                for (let row of rows) {
                    const text = row.innerText.trim();
                    if (text.toLowerCase().includes('elo score')) {
                        const parts = text.split(':');
                        if (parts.length > 1) {
                            return parts[1].trim();
                        }
                    }
                }
            }
            return null;
        });

        return eloScore || 'N/A';
    } catch (error) {
        console.error(`ELO fetch failed for ${playerId}:`, error);
        return 'Error';
    } finally {
        if (browser) await browser.close().catch(console.error);
    }
}


client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
  
    if (interaction.commandName === 'ping') {
      await interaction.reply('Pong!');
    }
  });

// Queue display function
async function sendQueueEmbed(message) {
    const team1 = [];
    const team2 = [];

    // Fill team slots
    for (let i = 0; i < 5; i++) {
        const player = queue[i];
        team1.push(player 
            ? `${(i+1).toString().padStart(2, '0')}. <@${player.id}> (${formatQueueTime(player.joinTime)})`
            : `${(i+1).toString().padStart(2, '0')}. Empty`
        );
    }

    for (let i = 5; i < 10; i++) {
        const player = queue[i];
        team2.push(player 
            ? `${(i+1).toString().padStart(2, '0')}. <@${player.id}> (${formatQueueTime(player.joinTime)})`
            : `${(i+1).toString().padStart(2, '0')}. Empty`
        );
    }

    const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle('Current Queue')
        .setDescription(`**${queue.length}/${maxSlots} players**`)
        .addFields(
            { name: 'Team 1', value: team1.join('\n'), inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Team 2', value: team2.join('\n'), inline: true }
        );

    await message.channel.send({ embeds: [embed] });
}

function formatQueueTime(joinTime) {
    const minutes = Math.floor((Date.now() - joinTime) / 60000);
    return `${minutes}m`;
}

client.login(process.env.DISCORD_TOKEN);