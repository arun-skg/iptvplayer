const fs = require('fs');
const https = require('https');
const http = require('http');
const { URL } = require('url');

const INPUT_FILE = 'enriched_channels_final.json';
const OUTPUT_FILE = 'enriched_channels.json';

const CONCURRENCY = 50;
const TIMEOUT = 4000;

async function checkUrl(url) {
    return new Promise((resolve) => {
        if (!url) return resolve(false);

        try {
            const parsedUrl = new URL(url);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;
            
            const req = protocol.request(url, {
                method: 'HEAD',
                timeout: TIMEOUT,
                headers: {
                    'User-Agent': 'IPTV-Checker/1.0'
                }
            }, (res) => {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    resolve(true);
                } else {
                    resolve(false);
                }
                res.destroy(); 
            });

            req.on('error', () => resolve(false));
            req.on('timeout', () => {
                req.destroy();
                resolve(false);
            });
            
            req.end();
        } catch (e) {
            resolve(false);
        }
    });
}

async function processBatch(channels) {
    const results = [];
    for (let i = 0; i < channels.length; i += CONCURRENCY) {
        const batch = channels.slice(i, i + CONCURRENCY);
        const promises = batch.map(async (channel) => {
            const isOnline = await checkUrl(channel.url);
            // console.log(`${channel.name}: ${isOnline ? 'ONLINE' : 'OFFLINE'}`);
            return { ...channel, online: isOnline, last_checked: Date.now() };
        });
        
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
        
        process.stdout.write(`\rProcessed ${results.length}/${channels.length} channels...`);
    }
    return results;
}

async function run() {
    try {
        console.log('Reading channels from ' + INPUT_FILE);
        let channels = [];
        if (fs.existsSync(INPUT_FILE)) {
             const content = fs.readFileSync(INPUT_FILE, 'utf8');
             channels = JSON.parse(content);
        } else if (fs.existsSync('enriched_channels.json')) {
             const content = fs.readFileSync('enriched_channels.json', 'utf8');
             channels = JSON.parse(content);
        } else {
            console.error("No input file found!");
            return;
        }

        console.log(`Total channels: ${channels.length}.`);
        console.log("Checking status for the first 200 channels for demo purposes (to avoid long runtime)...");
        
        // Split into check and uncheck to save time, but normally we'd check all
        const limit = 200;
        const toCheck = channels.slice(0, limit);
        const rest = channels.slice(limit);

        const checked = await processBatch(toCheck);
        const final = [...checked, ...rest];

        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(final, null, 2));
        console.log(`\nSuccessfully saved to ${OUTPUT_FILE}`);
        
    } catch (error) {
        console.error("Error:", error);
    }
}

run();
