import dotenv from 'dotenv';
import { Client, GatewayIntentBits, EmbedBuilder } from 'discord.js';
import { chromium } from 'playwright';
import fetch from 'node-fetch';
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
    "prizeddotas":"prizeddota",
    "blacklame556":"voo.doo.1"
};
const playerRealms = {
    "fieryfox": "EU",
    "hellhound0": "EU",
    "johnnycage5858": "EU",
    "chewbmomo":"EU",
    "redhawk8443":"EU",
    "mipastew":"NA",    
    "stormico": "EU",
    "bash5865": "NA",
    "tomoya3404": "NA",
    "tailofred": "EU",
    "rolando7433": "EU",
    "quanying":"EU",
    "kdbebrks": "EU",
    "mumix.": "NA",
    "markus96_phuphew":"EU",
    "asyl4ik.":"EU",
    "readingisfun":"NA",
    "ethamuffin":"NA",
    "rumarak":"EU",
    "1010.1010.1010":"NA",
    "jaguar0010":"NA",
    "xl3osk":"NA",
    "pojebanyskun":"EU",
    "danishpride":"EU",
    "iym5195":"EU",
    "fightordie0906":"EU",
    "mrksndvl":"EU",
    "peachtr333":"EU",
    "pudgeyjase":"EU",
    "fantom_9999":"NA",
    "stinkypez":"NA",
    "sleepybearfm":"NA",
    "dotaflintstone_72381":"EU",
    "upamecanoooooo.":"EU",
    "chrisbeaman":"NA",
    "taz4816":"EU",
    "onetwost3p":"EU",
    "boristheblade1033":"EU",
    "antbug":"NA",
    "syd.berna":"EU",
    "born.sinner30":"NA"
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

    // Cooldown handling
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
        const content = message.content.trim();

        if (content === '!q') return await handleQueueJoin(message);
        if (content === '!start') return await handleGameStart(message);
        if (content === '!del') return await handleQueueLeave(message);
        if (content === '!rg') return await sendQueueEmbed(message);if (content === '!upa') return await upa(message);
        if (content === '!admins') return await listAdmins(message);
        if (content.startsWith('!swap')) return await handleSwap(message);
        if (content.startsWith('!add')) return await handleAddPlayer(message);
        if (content.startsWith('!remove')) return await handleRemovePlayer(message);

        if (content.startsWith('!stats')) {
            const mention = message.mentions.users.first();
            const args = content.split(/\s+/);

            // Get target username from mention, typed arg, or fallback to author
            const targetUser = mention || 
                      (args[1] ? await client.users.fetch(args[1]).catch(() => null) : null) || 
                      message.author;
                      let displayName = null;
    try {
        const member = await message.guild.members.fetch(targetUser.id);
        displayName = member.displayName;
    } catch (e) {
        // Couldn't fetch member, just use username
    }

             const stats = await fetchPlayerStats(targetUser.username.toLowerCase(), displayName);
            if (!stats) {
                return message.reply("Couldn't fetch stats for that player.");
            }

            const statsText = 
`📊 Stats for ${stats.username}
────────────────────────────
ELO Score : ${stats.elo}
Games     : ${stats.games}
K/D/A     : ${stats.kda}
C/D       : ${stats.cd}
Rank      : ${stats.rank}
Rating    : ${stats.rating}
`;
message.channel.send(`\`\`\`text\n${statsText}\`\`\``);
        }

    } catch (error) {
        console.error('Command error:', error);
        return message.reply('An error occurred while processing your command.');
    }
});
async function upa(message) {
    message.channel.send("SAY UPAMECANOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO");
}


async function handleSwap(message) {
    console.log('Swap command received');
    const mentioned = [...message.mentions.users.values()];

    // Ensure exactly two users are mentioned
    if (mentioned.length !== 2) {
        return message.channel.send("Please mention exactly two users to swap!")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    const [user1, user2] = mentioned;

    // Find player1 in the queue
    const player1Index = queue.findIndex(p => p.id === user1.id);
    const player2Index = queue.findIndex(p => p.id === user2.id);

    // If player1 is in the queue, remove them from the queue
    if (player1Index === -1) {
        return message.channel.send(`${user1.username} is not in the queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    // If player2 is already in the queue, we cannot swap them in
    if (player2Index !== -1) {
        return message.channel.send(`${user2.username} is already in the queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    // Now remove player1 from the queue
    queue.splice(player1Index, 1);

    // Add player2 into the queue
    queue.push({
        id: user2.id,
        joinTime: Date.now(),
        username: user2.username.toLowerCase(),
        realm: playerRealms[user2.username.toLowerCase()] || 'Unknown'
    });

    // Send confirmation and update the queue display
    await message.channel.send(`Swapped ${user1.username} with ${user2.username}!`);
    await sendQueueEmbed(message);  // Update the queue display
}

async function listAdmins(message) {
    try {
        if (!message.guild) {
            return message.channel.send("This command only works in a server channel.");
        }

        // Get all members with the Dota-Admin role
        const adminRole = message.guild.roles.cache.find(role => 
            role.name.toLowerCase() === 'dota-admin'
        );

        if (!adminRole) {
            return message.channel.send("No 'Dota-Admin' role found on this server.");
        }

        // Fetch all members (might need to fetch if cache isn't complete)
        await message.guild.members.fetch();
        
        const admins = adminRole.members.map(member => member.user);

        if (admins.length === 0) {
            return message.channel.send("No users have the 'Dota-Admin' role.");
        }

        // Create a message listing all admins
        const adminList = admins.map(admin => `• ${admin.username} (${admin})`).join('\n');
        
        const embed = new EmbedBuilder()
            .setColor(0xFFA500) // Orange color for admin list
            .setTitle('Dota Admins')
            .setDescription(adminList)
            .setFooter({ text: `Total Admins: ${admins.length}` });

        await message.channel.send({ embeds: [embed] });

    } catch (error) {
        console.error('Error listing admins:', error);
        message.channel.send("An error occurred while trying to list admins.");
    }
}
async function handleGameStart(message) {
    if (queue.length < 2) {
        return message.channel.send("At least 2 players are required to start a game.")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    const playersWithElo = await Promise.all(queue.map(async player => {
        try {
            const user = await client.users.fetch(player.id);
            const username = user.username.toLowerCase();

            let member;
            let nickname;
            try {
                member = await message.guild.members.fetch(player.id);
                nickname = member.displayName || username;
            } catch (err) {
                console.error(`Member fetch error for ${username}:`, err);
                nickname = username;
            }

            let elo = eloCache[player.id];
            if (!elo) {
                // Fetch ELOs for players when the game starts
                const [eloUsername, eloNickname] = await Promise.allSettled([
                    fetchElo(username),
                    fetchElo(nickname)
                ]);

                const validNicknameElo = eloNickname.status === 'fulfilled' && eloNickname.value !== 1000;
                const validUsernameElo = eloUsername.status === 'fulfilled' && eloUsername.value !== 1000;

                elo = validNicknameElo ? eloNickname.value
                    : validUsernameElo ? eloUsername.value
                    : 1000;

                eloCache[player.id] = elo;
            }

            const tier = member ? getTierRole(member) : 3;
            const realm = playerRealms[username] || 'Unknown';

            // Calculate hybrid score with ELO and tier
            const hybridScore = calculateHybridScore({ elo, tier });

            return {
                id: player.id,
                name: nickname,
                username,
                elo,
                tier,
                hybridScore,
                realm
            };
        } catch (error) {
            console.error(`Player processing error:`, error);
            return {
                id: player.id,
                name: player.id,
                elo: 1000,
                tier: 3,
                hybridScore: calculateHybridScore({ elo: 1000, tier: 3 }),
                realm: 'Unknown'
            };
        }
    }));

    // Determine Majority Realm and Counts
    const realmData = determineMajorityRealm(playersWithElo); // Get counts and majority
    const realm = realmData.majority;
    const euCount = realmData.EU;
    const naCount = realmData.NA;

    // Balance the teams
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

    // Create the embed
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
            name: 'Server Realm',
            value: `EU: ${euCount}\nNA: ${naCount}\n**Resulted Realm:** ${realm}\n\n` + 
                   `**Team 1 Value:** ${team1Hybrid.toFixed(1)}\n` +
                   `**Team 2 Value:** ${team2Hybrid.toFixed(1)}\n` +
                   `**Difference:** ${Math.abs(team1Hybrid - team2Hybrid).toFixed(1)}`,
            inline: false
        }
    );

await message.channel.send({ embeds: [embed] });
await message.channel.send('`Now playing\n`' +
    `${playersWithElo.map(p => `<@${p.id}>`).join(' ')}\n` +
    'Please host the game: `FBG DotA`');
queue.length = 0;
}


// Function to determine Majority Realm and Counts
function determineMajorityRealm(players) {
    const realmCounts = { EU: 0, NA: 0 };

    players.forEach(player => {
        if (player.realm === 'EU') realmCounts.EU++;
        else if (player.realm === 'NA') realmCounts.NA++;
    });

    let majority;
    if (realmCounts.EU > realmCounts.NA) {
        majority = 'EU';
    } else if (realmCounts.NA > realmCounts.EU) {
        majority = 'NA';
    } else {
        majority = Math.random() < 0.5 ? 'EU' : 'NA';
    }

    return {
        majority,
        EU: realmCounts.EU,
        NA: realmCounts.NA
    };
}

async function handleQueueJoin(message) {
    // Check if the player is already in the queue
    if (queue.find(p => p.id === message.author.id)) {
        return message.channel.send(`${message.author}, you're already in queue!`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    // Check if the queue is full
    if (queue.length >= maxSlots) {
        return message.channel.send(`Queue is full! (${maxSlots}/10)`)
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    // Add player to the queue (without ELO fetch or hybrid score calculation)
    const username = message.author.username.toLowerCase();
    const realm = playerRealms[username] || 'Unknown';
    const member = await message.guild.members.fetch(message.author.id).catch(() => null);
    const tier = getTierRole(member);

    queue.push({
        id: message.author.id,
        username,
        realm,
        tier,
        joinTime: Date.now(),
        hybridScore: 0 // Hybrid score set to 0 on join
    });

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
    // Check if there are any mentioned users
    const mentionedUsers = message.mentions.users;
    if (mentionedUsers.size === 0) {
        return message.channel.send("Please mention at least one user to add!")
            .then(m => setTimeout(() => m.delete(), 5000));
    }

    const added = [];
    const alreadyQueued = [];
    const queueFull = [];

    // Process each mentioned user
    mentionedUsers.forEach(user => {
        const username = user.username.toLowerCase();
        const realm = playerRealms[username] || 'Unknown';

        // Check if the user is already in the queue
        if (queue.find(p => p.id === user.id)) {
            alreadyQueued.push(`${user.username} (${user.tag})`);
            return;
        }

        // Check if the queue is full
        if (queue.length >= maxSlots) {
            queueFull.push(`${user.username} (${user.tag})`);
            return;
        }

        // Add player to the queue without fetching ELO or calculating hybrid score
        queue.push({
            id: user.id,
            joinTime: Date.now(),
            username,
            realm,
            tier: 'Unknown', // Default to 'Unknown' tier
            hybridScore: 0  // Hybrid score set to 0 on add
        });

        added.push(`${user.username}`);
    });

    // Prepare and send the reply message
    let reply = '';
    if (added.length > 0) reply += `✅ Added: ${added.join(', ')}\n`;
    if (alreadyQueued.length > 0) reply += `⚠️ Already in queue: ${alreadyQueued.join(', ')}\n`;
    if (queueFull.length > 0) reply += `❌ Queue full for: ${queueFull.join(', ')}`;

    if (reply) await message.channel.send(reply);
    await sendQueueEmbed(message);
}

async function handleRemovePlayer(message) {
    let playerId = message.content.split(' ')[1];

    if (!playerId) {
        return message.channel.send("Please provide a valid player ID to remove.");
    }

    // Extract ID from mention if necessary
    const mentionMatch = playerId.match(/^<@!?(\d+)>$/);
    if (mentionMatch) {
        playerId = mentionMatch[1];
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
            const username = member?.user?.username?.toLowerCase() || '';
            const realm = player.realm || 'Unknown';

            const tier = getTierRole(member);
            const hybridScore = player.hybridScore || 0;  // Get hybrid score from player object

            line = `${(i + 1).toString().padStart(2, '0')}. ${mention} [${time}] (${tier}) - ${realm}`;
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

async function fetchPlayerStats(username, displayName = null) {
    if (!username || username.trim() === '') return null;

    // Apply username overrides first
    const overrideName = usernameOverrides[username] || username;
    const cleanUsername = overrideName.trim().replace(/\s+/g, '');
    
    // Clean display name if provided
    const cleanDisplayName = displayName ? displayName.trim().replace(/\s+/g, '') : null;

    // Try username first
    let stats = await fetchStatsFromUrlVariations(cleanUsername);
    
    // If no stats found with username, try display name (if different)
    if ((!stats || stats.elo === 1000) && cleanDisplayName && cleanDisplayName !== cleanUsername) {
        const displayNameStats = await fetchStatsFromUrlVariations(cleanDisplayName);
        if (displayNameStats && displayNameStats.elo !== 1000) {
            stats = displayNameStats;
        }
    }

    // Return null if no stats found at all
    if (!stats) return null;

    return {
        username,
        elo: stats.elo,
        games: stats.games,
        kda: stats.kda,
        cd: stats.cd,
        rank: stats.rank,
        rating: stats.rating || 'N/A'
    };
}

async function fetchStatsFromUrlVariations(name) {
    if (!name) return null;

    const urlVariations = [
        `https://stats.firstbloodgaming.com/player/${name}`,
        `https://stats.firstbloodgaming.com/player/${name.toLowerCase()}`,
        `https://stats.firstbloodgaming.com/player/${encodeURIComponent(name)}`
    ];

    let page;
    let stats = {
        elo: 1000,
        games: 'N/A',
        kda: 'N/A',
        cd: 'N/A',
        rank: 'N/A',
        rating: 'N/A'
    };

    for (const url of urlVariations) {
        try {
            page = pagePool.pop() || await context.newPage();
            await page.setDefaultTimeout(10000);
            await page.setDefaultNavigationTimeout(10000);

            console.log(`Fetching stats at ${url}`);
            await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: 10000
            });

            const notFound = await page.evaluate(() =>
                /player not found/i.test(document.body.textContent)
            );
            if (notFound) continue;

            const extractedStats = await page.evaluate(() => {
                const rows = [...document.querySelectorAll('tr')];
                const getStat = (label) => {
                    const row = rows.find(tr => {
                        const tds = tr.querySelectorAll('td');
                        return tds.length === 2 && new RegExp(label, 'i').test(tds[0].textContent);
                    });
                    return row ? row.querySelector('td:last-child').textContent.trim() : 'N/A';
                };
                
                const ratingElement = document.querySelector('.rating') || 
                                    document.querySelector('#rating') || 
                                    document.querySelector('.player-rating');
                const rating = ratingElement ? ratingElement.textContent.trim() : 'N/A';

                return {
                    elo: parseInt(getStat('elo score').replace(/\D/g, '')) || 1000,
                    games: getStat('games'),
                    kda: getStat('k/d/a'),
                    cd: getStat('c/d'),
                    rank: getStat('rank'),
                    rating
                };
            });

            // Only accept if we found valid stats (not all N/A)
            if (extractedStats.elo !== 1000 || 
                extractedStats.games !== 'N/A' || 
                extractedStats.kda !== 'N/A') {
                stats = extractedStats;
                break;
            }

        } catch (error) {
            console.error(`Failed to fetch stats at ${url}:`, error.message);
        } finally {
            if (page && !page.isClosed()) {
                pagePool.push(page);
            }
        }
    }

    return stats;
}



client.login(process.env.BOT_TOKEN);
