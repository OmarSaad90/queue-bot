import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { chromium } from 'playwright';

dotenv.config();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

let currentBotInstance;
let browser;
let context;
let pagePool = []; // Pool for reusing pages
let eloCache = {}; // Cache to store player ELOs

const usernameOverrides = {
    "natass7": "picatris",
    "pudgeyjase":"souljase",
    "readingisfun":"wilson",
    "prizeddotas":"prizeddota"
};

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    currentBotInstance = client;

    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();

    // Pre-create pages for reuse
    for (let i = 0; i < 3; i++) {
        pagePool.push(await context.newPage());
    }
});


const queue = [];
const maxSlots = 10;
const cooldowns = new Map();

client.on('messageCreate', async message => {
    if (message.author.bot) return;

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

    try {
        if (message.content === '!queue') return await handleQueueJoin(message);
        if (message.content === '!start1') return await handleGameStart(message);
        if (message.content === '!delete') return await handleQueueLeave(message);
        if (message.content === '!current') return await sendQueueEmbed(message);
        if (message.content.startsWith('!add1')) return await handleAddPlayer(message);
        if (message.content.startsWith('!remove1')) return await handleRemovePlayer(message);
    } catch (error) {
        console.error('Command error:', error);
    }
});

async function handleGameStart(message) {
    if (queue.length < 2) {
        return message.channel.send("At least 2 players are required to start a game.")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    const playersWithElo = await Promise.all(queue.map(async player => {
        try {
            let elo = eloCache[player.id];
            let member = null;
            let username, nickname;
    
            if (!elo) {
                const user = await client.users.fetch(player.id);
                try {
                    member = await message.guild.members.fetch(player.id);
                } catch (err) {
                    console.error(`Member fetch error: ${err}`);
                }
    
                username = user.username;
                nickname = member?.displayName || username;
    
                const [eloUsername, eloNickname] = await Promise.allSettled([
                    fetchElo(username),
                    fetchElo(nickname)
                ]);
                
                console.log('ELO fetch results:', {
                    username,
                    eloUsername: eloUsername.status === 'fulfilled' ? eloUsername.value : 'failed',
                    nickname,
                    eloNickname: eloNickname.status === 'fulfilled' ? eloNickname.value : 'failed'
                });
    
                const validNicknameElo = eloNickname.status === 'fulfilled' && eloNickname.value !== 1000;
                const validUsernameElo = eloUsername.status === 'fulfilled' && eloUsername.value !== 1000;
    
                elo = validNicknameElo ? eloNickname.value
                    : validUsernameElo ? eloUsername.value
                    : 1000;
    
                eloCache[player.id] = elo;
            } else {
                try {
                    member = await message.guild.members.fetch(player.id);
                } catch (err) {
                    console.error(`Member fetch error for cached player: ${err}`);
                }
            }
    
            const tier = member ? getTierRole(member) : 3;
            return { 
                id: player.id, 
                name: member?.displayName || username || player.id, 
                elo, 
                tier,
                hybridScore: calculateHybridScore({ elo, tier })
            };
        } catch (error) {
            console.error(`Player processing error:`, error);
            return { 
                id: player.id, 
                name: player.id, 
                elo: 1000, 
                tier: 3,
                hybridScore: calculateHybridScore({ elo: 1000, tier: 3 })
            };
        }
    }));

    const { team1, team2 } = balanceTeams(playersWithElo);
    
    // 50% chance to swap player display
    const shouldSwapDisplay = Math.random() < 0.5;
    const displayTeam1 = shouldSwapDisplay ? team2 : team1;
    const displayTeam2 = shouldSwapDisplay ? team1 : team2;

    // Sort display teams by ELO (highest first)
    const sortedDisplayTeam1 = [...displayTeam1].sort((a, b) => b.elo - a.elo);
    const sortedDisplayTeam2 = [...displayTeam2].sort((a, b) => b.elo - a.elo);

    // Calculate hybrid scores (using original teams for accurate balance metrics)
    const team1Hybrid = team1.reduce((sum, p) => sum + p.hybridScore, 0);
    const team2Hybrid = team2.reduce((sum, p) => sum + p.hybridScore, 0);

    const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle('Current Game')
        .addFields(
            {
                name: 'Team 1',
                value: sortedDisplayTeam1.map(p => `• <@${p.id}> (${p.elo})`).join('\n'),
                inline: true
            },
            {
                name: 'Team 2',
                value: sortedDisplayTeam2.map(p => `• <@${p.id}> (${p.elo})`).join('\n'),
                inline: true
            },
            {
                name: 'Team Balance',
                value: `**Team 1 Value:** ${team1Hybrid.toFixed(1)}\n` +
                       `**Team 2 Value:** ${team2Hybrid.toFixed(1)}\n` +
                       `**Difference:** ${Math.abs(team1Hybrid - team2Hybrid).toFixed(1)}`,
                inline: false
            }
        );

    await message.channel.send({ embeds: [embed] });
    queue.length = 0;
}


async function handleQueueJoin(message) {
    if (queue.find(p => p.id === message.author.id)) {
        return message.channel.send(`${message.author}, you're already in queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    if (queue.length >= maxSlots) {
        return message.channel.send(`Queue is full! (${maxSlots}/10)`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    queue.push({ id: message.author.id, joinTime: Date.now() });
    await sendQueueEmbed(message);
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
    const mentionedUsers = message.mentions.users;
    if (mentionedUsers.size === 0) {
        return message.channel.send("Please mention at least one user to add!")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    const added = [];
    const alreadyQueued = [];
    const queueFull = [];

    mentionedUsers.forEach(user => {
        // Check if the player is already in the queue
        if (queue.find(p => p.id === user.id)) {
            alreadyQueued.push(`${user.username} (${user.tag})`);
            return;
        }

        // Check if the queue is full
        if (queue.length >= maxSlots) {
            queueFull.push(`${user.username} (${user.tag})`);
            return;
        }

        // Add the player to the queue using their ID
        queue.push({ id: user.id, joinTime: Date.now() });
        added.push(`${user.username}`);
    });

    let reply = '';
    if (added.length > 0) reply += `✅ Added: ${added.join(', ')}\n`;
    if (alreadyQueued.length > 0) reply += `⚠️ Already in queue: ${alreadyQueued.join(', ')}\n`;
    if (queueFull.length > 0) reply += `❌ Queue full for: ${queueFull.join(', ')}`;

    if (reply) await message.channel.send(reply);
    await sendQueueEmbed(message);
}



async function handleRemovePlayer(message) {
    const playerId = message.content.split(' ')[1];
    if (!playerId) {
        return message.channel.send("Please provide a valid player ID to remove.");
    }

    const index = queue.findIndex(p => p.id === playerId);
    if (index === -1) {
        return message.channel.send(`<@${playerId}> is not in the queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    queue.splice(index, 1);
    await sendQueueEmbed(message);
}

async function sendQueueEmbed(message) {
    const team1 = [], team2 = [];

    for (let i = 0; i < 10; i++) {
        const player = queue[i];
        let line;

        if (player) {
            const member = await message.guild.members.fetch(player.id).catch(() => null);
            const mention = `<@${player.id}>`;
            const time = formatQueueTime(player.joinTime);
            const tier = getTierRole(member);

            line = `${(i + 1).toString().padStart(2, '0')}. ${mention} [${time}] (${tier})`;
        } else {
            line = `${(i + 1).toString().padStart(2, '0')}. Empty`;
        }

        if (i < 5) {
            team1.push(line);
        } else {
            team2.push(line);
        }
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


function getTierRole(member) {
    if (!member) return 'No Tier';

    const tierRegex = /^DotA Tier (\d(?:\.5)?)$/;

    for (const role of member.roles.cache.values()) {
        const match = tierRegex.exec(role.name);
        if (match) {
            return match[1];
        }
    }

    return 'No Tier';
}

function formatQueueTime(joinTime) {
    const minutes = Math.floor((Date.now() - joinTime) / 60000);
    return `${minutes} m`;
}

function balanceTeams(playersWithEloAndTier) {
    const sortedPlayers = [...playersWithEloAndTier]
        .sort((a, b) => calculateHybridScore(b) - calculateHybridScore(a));

    const team1 = [];
    const team2 = [];
    let team1Hybrid = 0;
    let team2Hybrid = 0;

    for (let i = 0; i < 10 && i < sortedPlayers.length; i++) {
        const player = sortedPlayers[i];
        const playerScore = calculateHybridScore(player);

        if (i === 0) {
            team1.push(player);
            team1Hybrid += playerScore;
        } else if (i === 1 || i === 2) {
            team2.push(player);
            team2Hybrid += playerScore;
        } else if (i === 3 || i === 4) {
            team1.push(player);
            team1Hybrid += playerScore;
        } else if (i === 5 || i === 6) {
            team2.push(player);
            team2Hybrid += playerScore;
        } else if (i === 7 || i === 9) {
            team1.push(player);
            team1Hybrid += playerScore;
        } else if (i === 8) {
            team2.push(player);
            team2Hybrid += playerScore;
        }
    }

    const totalElo1 = team1.reduce((sum, p) => sum + p.elo, 0);
    const totalElo2 = team2.reduce((sum, p) => sum + p.elo, 0);

    return { team1, team2, totalElo1, totalElo2 };
}

function normalizeTier(tier) {
    const tierMap = {
        1: 4,
        1.5: 3.5,
        2: 3,
        2.5: 2.5,
        3: 2,
        3.5: 1.5,
        4: 1
    };
    return tierMap[tier] || 0;
}

function normalizeELO(elo) {
    return (elo - 1000) / 200;
}

function calculateHybridScore(player) {
    const normalizedTier = normalizeTier(player.tier);
    const normalizedELO = normalizeELO(player.elo);
    return normalizedTier + normalizedELO;
}
async function fetchElo(username) {
    if (!username || username.trim() === '') return 1000;

    // Check overrided names first
    const overrideName = usernameOverrides[username] || username;

    const cleanUsername = overrideName.trim().replace(/\s+/g, '');
    const urlVariations = [
        `https://stats.firstbloodgaming.com/player/${cleanUsername}`,
        `https://stats.firstbloodgaming.com/player/${cleanUsername.toLowerCase()}`,
        `https://stats.firstbloodgaming.com/player/${encodeURIComponent(cleanUsername)}`
    ];

    let page;
    let elo = null;

    for (const url of urlVariations) {
        try {
            page = pagePool.pop() || await context.newPage();
            await page.setDefaultTimeout(10000);
            await page.setDefaultNavigationTimeout(10000);

            console.log(`Fetching ELO for ${username} at ${url}`);

            await page.goto(url, { 
                waitUntil: 'domcontentloaded', 
                timeout: 10000 
            });

            const notFound = await page.evaluate(() => 
                /player not found/i.test(document.body.textContent)
            );
            if (notFound) continue;

            elo = await page.evaluate(() => {
                const eloRow = [...document.querySelectorAll('tr')].find(tr => {
                    const tds = tr.querySelectorAll('td');
                    return tds.length === 2 && /elo score/i.test(tds[0].textContent);
                });
                return eloRow ? parseInt(eloRow.querySelector('td:last-child').textContent.replace(/\D/g, '')) || null : null;
            });

            if (elo && elo !== 1000) {
                console.log(`Found valid ELO for ${username}: ${elo}`);
                break;
            }

        } catch (error) {
            console.error(`Fetch failed for ${url}:`, error.message);
        } finally {
            if (page && !page.isClosed()) {
                pagePool.push(page);
            }
        }
    }

    return elo !== null ? elo : 1000;
}


client.login(process.env.BOT_TOKEN);
