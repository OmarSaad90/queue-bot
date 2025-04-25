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

// Puppeteer-based function to fetch ELO
async function fetchElo(playerId) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const playerUrl = `https://stats.firstbloodgaming.com/player/${playerId}`;
    await page.goto(playerUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const elo = await page.evaluate(() => {
        const textContent = document.body.textContent;
        const match = textContent.match(/ELO Score\s*:\s*(\d+)/); // Regex to find ELO Score
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

            queue.length = 0; // Clear the queue after notifying
            return;
        }

        // Add player to the queue
        queue.push({ id: message.author.id, joinTime: Date.now() });

        // Fetch ELO for the player
        const elo = await fetchElo(message.author.tag); // Use tag or username as needed

        sendQueueEmbed(message, `Current Queue: ${elo ? `\n**Your ELO: ${elo}**` : ""}`);
    }

    // Command to start the game
    if (message.content === '!start') {
        if (queue.length === 0) {
            return message.channel.send("The queue is empty!");
        }

        let pingMessage = 'The game is ready! Players:\n';
        queue.forEach(player => {
            pingMessage += `<@${player.id}> `;
        });

        message.channel.send(pingMessage);
        queue.length = 0; // Clear the queue after starting
        sendQueueEmbed(message, "Queue cleared after game start:");
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

    // Command to add a specific user to the queue
    if (message.content.startsWith('!add')) {
        const userToAdd = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);

        if (queue.some(player => player.id === userToAdd.id)) {
            return message.channel.send(`${userToAdd.tag} is already in the queue!`);
        }

        if (queue.length >= maxSlots) {
            return message.channel.send(`The queue is full! (${maxSlots} players max)`);
        }

        queue.push(userToAdd);
        message.channel.send(`${userToAdd.tag} has been added to the queue!`);
        sendQueueEmbed(message, "Current Queue:");
    }

    // Command to remove a specific user from the queue
    if (message.content.startsWith('!remove')) {
        const userToRemove = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);

        const index = queue.findIndex(player => player.id === userToRemove.id);
        if (index === -1) {
            return message.channel.send(`${userToRemove.tag} is not in the queue!`);
        }

        queue.splice(index, 1);
        message.channel.send(`${userToRemove.tag} has been removed from the queue!`);
        sendQueueEmbed(message, "Current Queue:");
    }
});

function sendQueueEmbed(message, description) {
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
        .setDescription(description)
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
    const timeInQueue = currentTime - joinTime;
    const minutes = Math.floor(timeInQueue / 60000);
    return `${minutes}m`;
}

client.login(process.env.DISCORD_TOKEN);
