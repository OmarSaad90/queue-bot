require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const express = require('express'); // Import express to handle port binding for web service
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
const port = process.env.PORT || 3000; // Use the port from environment variables (Render will provide this)

app.get('/', (req, res) => {
    res.send('Bot is running!');
});

// Start the web server (This will allow your app to bind to a port on Render)
app.listen(port, () => {
    console.log(`Web server is listening on port ${port}`);
});

const queue = []; // Global array for players in the queue
const maxSlots = 10; // Max number of players in the queue


client.on('messageCreate', message => {
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
        queue.forEach(player => {
            pingMessage += `<@${player.id}> `;
        });
    
        message.channel.send(pingMessage);
    
        // Optionally clear the queue after starting
        queue.length = 0;
    
        // Optionally show updated (empty) queue
        sendQueueEmbed(message, "Queue cleared after game start:");
    }
    // Command to leave the queue
    if (message.content === '!del') {
        // Check if the user is in the queue
        const index = queue.findIndex(player => player.id === message.author.id);
        if (index === -1) {
            return message.channel.send(`${message.author.tag}, you are not in the queue!`);
        }

        // Remove user from the queue
        queue.splice(index, 1);

        // Call the function to display the queue
        sendQueueEmbed(message, "Current Queue:");
    }

    // Command to view the current queue
    if (message.content === '!rg') {
        sendQueueEmbed(message, "Current Queue:");
    }
    if (message.content.startsWith('!add')) {
        // Get the user mentioned (or user ID)
        const userToAdd = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);

        // Check if the user is already in the queue
        if (queue.some(player => player.id === userToAdd.id)) {
            return message.channel.send(`${userToAdd.tag} is already in the queue!`);
        }

        // Check if the queue is full
        if (queue.length >= maxSlots) {
            return message.channel.send(`The queue is full! (${maxSlots} players max)`);
        }

        // Add user to the queue
        queue.push(userToAdd);
        message.channel.send(`${userToAdd.tag} has been added to the queue!`);

        // Call the function to display the queue
        sendQueueEmbed(message, "Current Queue:");
    }

    // Command to remove a specific user from the queue
    if (message.content.startsWith('!remove')) {
        // Get the user mentioned (or user ID)
        const userToRemove = message.mentions.users.first() || message.guild.members.cache.get(message.content.split(' ')[1]);

        // Check if the user is in the queue
        const index = queue.findIndex(player => player.id === userToRemove.id);
        if (index === -1) {
            return message.channel.send(`${userToRemove.tag} is not in the queue!`);
        }

        // Remove user from the queue
        queue.splice(index, 1);
        message.channel.send(`${userToRemove.tag} has been removed from the queue!`);

        // Call the function to display the queue
        sendQueueEmbed(message, "Current Queue:");
    }
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
