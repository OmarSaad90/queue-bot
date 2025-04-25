const puppeteer = require('puppeteer');

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

// Test with a specific player ID
fetchElo('ChrisBeaman');
