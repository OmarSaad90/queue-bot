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
const maxSlots = 10;
const cooldowns = new Map(); // Initialize cooldowns map

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Cooldown system
    if (!cooldowns.has(message.author.id)) {
        cooldowns.set(message.author.id, new Map());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(message.author.id);
    const cooldownAmount = 2000; // 2 seconds cooldown

    if (timestamps.has(message.content)) {
        const expirationTime = timestamps.get(message.content) + cooldownAmount;
        if (now < expirationTime) {
            return message.reply(`Please wait ${((expirationTime - now) / 1000).toFixed(1)} more seconds before using this command again.`)
                .then(msg => setTimeout(() => msg.delete(), 3000));
        }
    }

    timestamps.set(message.content, now);
    setTimeout(() => timestamps.delete(message.content), cooldownAmount);

    // Command to join the queue
    if (message.content === '!q') {
        if (queue.some(player => player.id === message.author.id)) {
            return message.channel.send(`${message.author}, you are already in the queue!`)
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        if (queue.length >= maxSlots) {
            const fullMessage = await message.channel.send(`The queue is full! (${maxSlots} players max)`);
            
            let pingMessage = 'The queue is now full! Playing: \n';
            queue.forEach(player => {
                pingMessage += `<@${player.id}> `;
            });
            
            await message.channel.send(pingMessage);
            queue.length = 0;
            
            setTimeout(() => fullMessage.delete(), 5000);
            return;
        }

        queue.push({ id: message.author.id, joinTime: Date.now() });
        await sendQueueEmbed(message, "Current Queue:");
        return;
    }

    // !start command
    if (message.content === '!start') {
        if (queue.length === 0) {
            return message.channel.send("The queue is empty! Please add players to the queue.")
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        const playersInQueue = queue.filter(player => player && player.id);
        if (playersInQueue.length === 0) {
            return message.channel.send("There are no valid players in the queue.")
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        try {
            let pingMessage = 'The game is ready! Players:\n';
            const eloFetchPromises = playersInQueue.map(async (player) => {
                try {
                    const elo = await fetchElo(player.id);
                    return { id: player.id, elo: elo || 'N/A' };
                } catch (error) {
                    console.error(`Error fetching ELO for ${player.id}:`, error);
                    return { id: player.id, elo: 'Error fetching score' };
                }
            });

            const playerInfos = await Promise.all(eloFetchPromises);
            playerInfos.forEach(player => {
                pingMessage += `<@${player.id}> (ELO: ${player.elo})\n`;
            });

            await message.channel.send(pingMessage);
            queue.length = 0;
            await sendQueueEmbed(message, "Queue cleared after game start:");
            await message.delete().catch(console.error);
        } catch (err) {
            console.error("Error in !start command:", err);
            await message.channel.send("There was an error processing the command.")
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }
        return;
    }

    // Command to leave the queue
    if (message.content === '!del') {
        const index = queue.findIndex(player => player.id === message.author.id);
        if (index === -1) {
            return message.channel.send(`${message.author}, you are not in the queue!`)
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        queue.splice(index, 1);
        await sendQueueEmbed(message, "Current Queue:");
        return;
    }

    // Command to view the current queue
    if (message.content === '!rg') {
        await sendQueueEmbed(message, "Current Queue:");
        return;
    }

    if (message.content.startsWith('!add')) {
        const userToAdd = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);
        if (!userToAdd) {
            return message.channel.send("Please mention a user or provide a valid user ID.")
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        if (queue.some(player => player.id === userToAdd.id)) {
            return message.channel.send(`${userToAdd}, you are already in the queue!`)
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        if (queue.length >= maxSlots) {
            return message.channel.send(`The queue is full! (${maxSlots} players max)`)
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        queue.push({ id: userToAdd.id, joinTime: Date.now() });
        await message.channel.send(`${userToAdd} has been added to the queue!`);
        await sendQueueEmbed(message, "Current Queue:");
        return;
    }

    if (message.content.startsWith('!remove')) {
        const userToRemove = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);
        if (!userToRemove) {
            return message.channel.send("Please mention a user or provide a valid user ID.")
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        const index = queue.findIndex(player => player.id === userToRemove.id);
        if (index === -1) {
            return message.channel.send(`${userToRemove} is not in the queue!`)
                .then(msg => setTimeout(() => msg.delete(), 5000));
        }

        queue.splice(index, 1);
        await message.channel.send(`${userToRemove} has been removed from the queue!`);
        await sendQueueEmbed(message, "Current Queue:");
        return;
    }
});

async function fetchElo(playerId) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        await page.setDefaultNavigationTimeout(30000);

        const playerUrl = `https://stats.firstbloodgaming.com/player/${playerId}`;
        await page.goto(playerUrl, { waitUntil: 'networkidle2', timeout: 30000 });

        const elo = await page.evaluate(() => {
            // Try multiple ways to find ELO
            const eloElement = document.querySelector('.elo-score') || 
                             document.querySelector('[class*="elo"]') ||
                             Array.from(document.querySelectorAll('*'))
                                .find(el => el.textContent.includes('ELO Score'));
            
            if (eloElement) {
                const match = eloElement.textContent.match(/\d+/);
                return match ? match[0] : null;
            }
            return null;
        });

        if (!elo) {
            throw new Error('ELO not found on page');
        }

        return elo;
    } catch (error) {
        console.error(`Failed to fetch ELO for ${playerId}:`, error);
        throw error;
    } finally {
        if (browser) {
            await browser.close().catch(console.error);
        }
    }
}

function sendQueueEmbed(message, title = "Current Queue") {
    const team1 = [];
    const team2 = [];

    for (let i = 0; i < 5; i++) {
        const player = queue[i];
        if (player) {
            const time = formatQueueTime(player.joinTime);
            team1.push(`${(i + 1).toString().padStart(2, '0')}. <@${player.id}> (${time})`);
        } else {
            team1.push(`${(i + 1).toString().padStart(2, '0')}. Empty`);
        }
    }

    for (let i = 5; i < 10; i++) {
        const player = queue[i];
        if (player) {
            const time = formatQueueTime(player.joinTime);
            team2.push(`${(i + 1).toString().padStart(2, '0')}. <@${player.id}> (${time})`);
        } else {
            team2.push(`${(i + 1).toString().padStart(2, '0')}. Empty`);
        }
    }

    const embed = new EmbedBuilder()
        .setColor(0x00AE86)
        .setTitle(title)
        .setDescription(`**${queue.length} / ${maxSlots} players**`)
        .addFields(
            { name: 'Team 1', value: team1.join('\n'), inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Team 2', value: team2.join('\n'), inline: true }
        )
        .setTimestamp();

    return message.channel.send({ embeds: [embed] });
}

function formatQueueTime(joinTime) {
    const currentTime = Date.now();
    const timeInQueue = currentTime - joinTime;
    const minutes = Math.floor(timeInQueue / 60000);
    return `${minutes}m`;
}

client.login(process.env.DISCORD_TOKEN);