const axios = require('axios');
const fs = require('fs');
const path = require('path');

const IMAGE_DIR = path.join(__dirname, 'logos');
const JSON_PATH = path.join(__dirname, 'stations.json');
const IMAGE_BASE_URL = 'https://www.eternityready.com/radio/img/';

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

if (!fs.existsSync(IMAGE_DIR)) fs.mkdirSync(IMAGE_DIR);

// 🧾 Downloads a valid image
async function downloadImage(url, filename) {
    if (!url || !filename) return '';
    try {
        const ext = path.extname(new URL(url).pathname).split('?')[0] || '.png';
        const fullName = `${filename}${ext}`;
        const imagePath = path.join(IMAGE_DIR, fullName);
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        fs.writeFileSync(imagePath, response.data);
        return `${IMAGE_BASE_URL}${fullName}`;
    } catch (err) {
        console.warn(`⚠️ Failed image download for ${filename}`);
        return '';
    }
}

const cheerio = require('cheerio');

async function extractLogoFromWebsite(homepage, stationName) {
    if (!homepage) return '';

    try {
        // Normalize protocol if missing
        let finalHomepage = homepage.startsWith('http') ? homepage : `http://${homepage}`;

        // 1. Try fetching the HTML
        let response;
        try {
            response = await axios.get(finalHomepage, { timeout: 15000 });
        } catch (err) {
            if (finalHomepage.startsWith('https://')) {
                finalHomepage = finalHomepage.replace('https://', 'http://');
                console.warn(`🔁 Retrying over HTTP: ${finalHomepage}`);
                response = await axios.get(finalHomepage, { timeout: 15000 });
            } else {
                throw err;
            }
        }

        const html = response.data;
        const $ = cheerio.load(html);

        // 2. Find the first <img> with or without 'logo'
        const logoCandidate = $('img')
            .filter((_, el) => {
                const src = $(el).attr('src')?.toLowerCase() || '';
                return src.includes('logo');
            })
            .first();

        const rawSrc = logoCandidate.attr('src');
        if (!rawSrc) {
            console.warn(`⚠️ No <img> logo candidate found for ${stationName}`);
            return '';
        }

        // 3. Build absolute URL if needed
        const logoURL = new URL(rawSrc, finalHomepage).href;

        console.log(`🧲 Cheerio logo found for ${stationName}: ${logoURL}`);
        return await downloadImage(logoURL, stationName);
    } catch (err) {
        console.warn(`❌ Failed cheerio logo extraction for ${stationName} from ${homepage}: ${err.message}`);
        return '';
    }
}


// 🚀 Main logic to collect stations
async function main() {
    const browser = await puppeteer.launch({ headless: false });
    const allStations = [];

    let offset = 0;
    const limit = 500;
    const targetCount = 200;

    while (allStations.length < targetCount) {
        console.log(`🔄 Fetching stations ${offset} to ${offset + limit}...`);
        const res = await axios.get(`https://fi1.api.radio-browser.info/json/stations/search`, {
            params: {
                offset,
                limit,
                tagList: 'christian',
                hidebroken: true,
                order: 'clickcount',
                reverse: true
            }
        });

        let i = 0;

        const stations = res.data;
        if (!stations.length) break;

        for (const station of stations) {
            const name = station.name?.trim();
            const stream = station.url_resolved;
            const genre = station.tags?.split(',')[0]?.trim() || 'Christian';
            const homepage = station.homepage;

            if (!name || !stream) continue;

            const safeName = name;
            let logo = await downloadImage(station.favicon, safeName);

            console.log(logo, "logo,", i++)

            if (logo) {
                allStations.push({
                    name,
                    description: `Christian radio station from ${station.country || 'Unknown'}.`,
                    src: stream,
                    logo,
                    tags: ["", ""],
                    rating: 4,
                    categories: [genre]
                });
                console.log(`✅ Added: ${name}`);

            }


            if (allStations.length >= targetCount) break;
        }

        offset += limit;
    }

    fs.writeFileSync(JSON_PATH, JSON.stringify(allStations, null, 2));
    console.log(`✅ DONE: Saved ${allStations.length} stations to ${JSON_PATH}`);
    await browser.close();
}

main();
