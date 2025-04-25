require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');
const express = require('express');
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Express web server to bind to a port
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

app.listen(port, () => {
    console.log(`Web server is listening on port ${port}`);
});

const queue = []; // Global array for players in the queue
const maxSlots = 10; // Max number of players in the queue

// Fetch ELO using Puppeteer
async function fetchElo(playerId) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const playerUrl = `https://stats.firstbloodgaming.com/player/${playerId}`;
    await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Search for ELO Score in the page text using regex
    const elo = await page.evaluate(() => {
        const textContent = document.body.textContent; // Get the entire text of the page
        const match = textContent.match(/ELO Score\s*:\s*(\d+)/);  // Regex to find the ELO Score

        // Return the ELO score if found, otherwise return null
        return match ? match[1] : null;
    });

    await browser.close();

    if (elo) {
        console.log(`ELO Score for player ${playerId}: ${elo}`);
        return elo;
    } else {
        console.log(`ELO Score not found for player ${playerId}`);
        return null;
    }
}

client.on('messageCreate', async (message) => {
    // Ignore messages from the bot itself
    if (message.author.bot) return;

    // Command to join the queue
    if (message.content === '!q') {
        // Check if the user is already in the queue
        if (queue.some(player => player.id === message.author.id)) {
            return message.channel.send(`${message.author.tag}, you are already in the queue!`);
        }

        // Check if the queue is full
        if (queue.length >= maxSlots) {
            message.channel.send(`The queue is full! (${maxSlots} players max)`);

            // Ping all players
            let pingMessage = 'The queue is now full! Playing: \n';
            queue.forEach(player => {
                pingMessage += `<@${player.id}> `;
            });
            message.channel.send(pingMessage);

            queue.length = 0;
            return;
        }

        // Add to queue
        queue.push({ id: message.author.id, joinTime: Date.now() });

        sendQueueEmbed(message, "Current Queue:");
    }

    if (message.content === '!start') {
        if (queue.length === 0) {
            return message.channel.send("The queue is empty!");
        }

        let pingMessage = 'The game is ready! Players:\n';
        for (let player of queue) {
            pingMessage += `<@${player.id}> `;
        }

        message.channel.send(pingMessage);

        // Fetch ELOs for each player in the queue using Puppeteer
        let eloMessages = '';
        for (let player of queue) {
            const playerName = player.id; // Adjust this if playerId is not the Discord ID
            const elo = await fetchElo(playerName);
            eloMessages += `<@${player.id}>: ELO - ${elo || 'Not found'}\n`;
        }

        message.channel.send(eloMessages);

        // Optionally clear the queue after starting
        queue.length = 0;

        // Optionally show updated (empty) queue
        sendQueueEmbed(message, "Queue cleared after game start:");
    }

    // Other commands like !del, !rg, !add, !remove...
});

// Function to display the queue in an embed format with timer
function sendQueueEmbed(message) {
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

// Function to format the queue time into minutes
function formatQueueTime(joinTime) {
    const currentTime = Date.now();
    const timeInQueue = currentTime - joinTime; // Time in milliseconds
    const minutes = Math.floor(timeInQueue / 60000); // Convert to minutes
    return `${minutes}m`; // Return the time in minutes
}

client.login(process.env.DISCORD_TOKEN);
