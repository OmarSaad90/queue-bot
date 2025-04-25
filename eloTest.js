require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express');
const puppeteer = require('puppeteer');  // Import puppeteer for scraping ELO score
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

const queue = [];
const maxSlots = 10;

client.on('messageCreate', message => {
    if (message.author.bot) return;

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

    if (message.content === '!start') {
        if (queue.length === 0) {
            return message.channel.send("The queue is empty!");
        }

        let pingMessage = 'The game is ready! Players:\n';
        const playerPromises = queue.map(async (player) => {
            const elo = await fetchElo(player.id);  // Fetch the ELO score for each player
            pingMessage += `<@${player.id}> (ELO: ${elo || 'N/A'})\n`;  // Display the ELO score
        });

        // Wait for all ELO scores to be fetched
        Promise.all(playerPromises).then(() => {
            message.channel.send(pingMessage);
            queue.length = 0; // Optionally clear the queue after starting
            sendQueueEmbed(message, "Queue cleared after game start:");
        });
    }

    // Other commands like !del, !rg, etc.
});

async function fetchElo(playerId) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const playerUrl = `https://stats.firstbloodgaming.com/player/${playerId}`;
    await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const elo = await page.evaluate(() => {
        const textContent = document.body.textContent;
        const match = textContent.match(/ELO Score\s*:\s*(\d+)/);

        return match ? match[1] : null;
    });

    await browser.close();

    return elo;
}

function sendQueueEmbed(message, title) {
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
        .setDescription(`${title} **${queue.length} / ${maxSlots}**`)
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
