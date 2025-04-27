const puppeteer = require('puppeteer');

async function testElo() {
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.goto('https://stats.firstbloodgaming.com/player/hellhound', { waitUntil: 'networkidle2' });

    await new Promise(resolve => setTimeout(resolve, 3000));

    const tables = await page.$$eval('div.column article table', tables => {
        return tables.map(table => table.innerText);
    });

    if (tables.length >= 2) {
        const table2Text = tables[1];

        // Use regex to find "ELO Score: <number>"
        const eloMatch = table2Text.match(/ELO Score:\s*(\d+)/);

        if (eloMatch) {
            const eloScore = eloMatch[1];
            console.log(`ELO Score found: ${eloScore}`);
        } else {
            console.log('ELO Score not found.');
        }
    } else {
        console.log('Not enough tables found.');
    }

    await browser.close();
}

testElo();
