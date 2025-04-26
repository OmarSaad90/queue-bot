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

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Command to join the queue
    if (message.content === '!q') {
        if (queue.some(player => player.id === message.author.id)) {
            return message.channel.send(`${message.author.tag}, you are already in the queue!`);
        }

        if (queue.length >= maxSlots) {
            message.channel.send(`The queue is full! (${maxSlots} players max)`);

            let pingMessage = 'The queue is now full! Playing: \n';
            queue.forEach(player => {
                pingMessage += `<@${player.id}> `;
            });
            message.channel.send(pingMessage);

            queue.length = 0;
            return;
        }

        queue.push({ id: message.author.id, joinTime: Date.now() });
        sendQueueEmbed(message, "Current Queue:");
    }

    // !start command
    if (message.content === '!start') {
        if (queue.length === 0) {
            return message.channel.send("The queue is empty! Please add players to the queue.");
        }

        let pingMessage = 'The game is ready! Players:\n';
        const playersInQueue = queue.filter(player => player && player.id);

        if (playersInQueue.length === 0) {
            return message.channel.send("There are no valid players in the queue.");
        }

        try {
            // Fetch all ELOs first
            const playerInfos = await Promise.all(playersInQueue.map(async (player) => {
                try {
                    const elo = await fetchElo(player.id);
                    return { id: player.id, elo: elo || 'N/A' };
                } catch (error) {
                    console.error(`Error fetching ELO for ${player.id}:`, error);
                    return { id: player.id, elo: 'Error fetching score' };
                }
            }));

            // Build the message after all ELOs are fetched
            playerInfos.forEach(player => {
                pingMessage += `<@${player.id}> (ELO: ${player.elo})\n`;
            });

            await message.channel.send(pingMessage);
            queue.length = 0;
            sendQueueEmbed(message, "Queue cleared after game start:");
            await message.delete().catch(console.error);
        } catch (err) {
            console.error("Error processing !start command:", err);
            await message.channel.send("There was an error processing the command.");
        }
    }

    // Command to leave the queue
    if (message.content === '!del') {
        const index = queue.findIndex(player => player.id === message.author.id);
        if (index === -1) {
            return message.channel.send(`${message.author.tag}, you are not in the queue!`);
        }

        queue.splice(index, 1);
        sendQueueEmbed(message, "Current Queue:");
    }

    // Command to view the current queue
    if (message.content === '!rg') {
        sendQueueEmbed(message, "Current Queue:");
    }

    if (message.content.startsWith('!add')) {
        const userToAdd = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);
        if (!userToAdd) return message.channel.send("Please mention a user or provide a valid user ID.");

        if (queue.some(player => player.id === userToAdd.id)) {
            return message.channel.send(`${userToAdd.tag} is already in the queue!`);
        }

        if (queue.length >= maxSlots) {
            return message.channel.send(`The queue is full! (${maxSlots} players max)`);
        }

        queue.push({ id: userToAdd.id, joinTime: Date.now() });
        message.channel.send(`${userToAdd.tag} has been added to the queue!`);
        sendQueueEmbed(message, "Current Queue:");
    }

    if (message.content.startsWith('!remove')) {
        const userToRemove = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);
        if (!userToRemove) return message.channel.send("Please mention a user or provide a valid user ID.");

        const index = queue.findIndex(player => player.id === userToRemove.id);
        if (index === -1) {
            return message.channel.send(`${userToRemove.tag} is not in the queue!`);
        }

        queue.splice(index, 1);
        message.channel.send(`${userToRemove.tag} has been removed from the queue!`);
        sendQueueEmbed(message, "Current Queue:");
    }
});

async function fetchElo(playerId) {
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Recommended for server environments
        });
        const page = await browser.newPage();
        
        // Set a reasonable timeout
        await page.setDefaultNavigationTimeout(60000);
        
        const playerUrl = `https://stats.firstbloodgaming.com/player/${playerId}`;
        await page.goto(playerUrl, { waitUntil: 'networkidle2' });

        const elo = await page.evaluate(() => {
            const textContent = document.body.textContent;
            const match = textContent.match(/ELO Score\s*:\s*(\d+)/);
            return match ? match[1] : null;
        });

        if (!elo) throw new Error("ELO not found on page");
        
        return elo;
    } catch (error) {
        console.error(`Error fetching ELO for ${playerId}:`, error);
        throw error; // Re-throw to handle in the calling function
    } finally {
        if (browser) await browser.close().catch(console.error);
    }
}

function sendQueueEmbed(message) {
    // ... (keep your existing sendQueueEmbed implementation)
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
        .setDescription(`Current queue **${queue.length} / ${maxSlots}**`)
        .addFields(
            { name: 'Team 1', value: team1.join('\n'), inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: 'Team 2', value: team2.join('\n'), inline: true }
        )
        .setTimestamp();

    message.channel.send({ embeds: [embed] });
}

function formatQueueTime(joinTime) {
    const currentTime = Date.now();
    const timeInQueue = currentTime - joinTime; // Time in milliseconds
    const minutes = Math.floor(timeInQueue / 60000); // Convert to minutes
    return `${minutes}m`; // Return the time in minutes
   
}

client.login(process.env.DISCORD_TOKEN);