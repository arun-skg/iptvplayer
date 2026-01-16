
const fs = require('fs');
const https = require('https');

const M3U_URL = 'https://iptv-org.github.io/iptv/index.m3u';
const CHANNELS_JSON_URL = 'https://iptv-org.github.io/api/channels.json';
const OUTPUT_FILE = 'enriched_channels.json';

// Helper to fetch data
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// M3U Parser
function parseM3U(content) {
    const lines = content.split('\n');
    const channels = [];
    let currentChannel = null;

    lines.forEach(line => {
        line = line.trim();
        if (line.startsWith('#EXTINF:')) {
            const info = line.substring(8);
            const params = {};
            
            // Extract key="value" pairs
            const matches = info.matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g);
            for (const match of matches) {
                params[match[1]] = match[2];
            }
            
            // Extract Name (after the last comma)
            const name = info.substring(info.lastIndexOf(',') + 1).trim();
            
            currentChannel = {
                name: name,
                tvgId: params['tvg-id'],
                logo: params['tvg-logo'],
                group: params['group-title'],
                language: params['tvg-language'],
                country: params['tvg-country'],
                url: ''
            };
        } else if (line.startsWith('http') && currentChannel) {
            currentChannel.url = line;
            channels.push(currentChannel);
            currentChannel = null;
        }
    });
    return channels;
}

async function run() {
    console.log('Fetching M3U playlist...');
    const m3uContent = await fetchUrl(M3U_URL);
    const m3uChannels = parseM3U(m3uContent);
    console.log(`Parsed ${m3uChannels.length} channels from M3U.`);

    console.log('Fetching enriched channel metadata...');
    const channelsJsonStr = await fetchUrl(CHANNELS_JSON_URL);
    const metadataList = JSON.parse(channelsJsonStr);
    console.log(`Loaded ${metadataList.length} metadata records.`);

    // Create a Map for faster lookup by ID
    const metadataMap = new Map();
    metadataList.forEach(m => {
        if (m.id) metadataMap.set(m.id, m);
    });

    console.log('Enriching data...');
    const enrichedChannels = m3uChannels.map(c => {
        let lookupId = c.tvgId;
        if (lookupId && !metadataMap.has(lookupId) && lookupId.includes('@')) {
            lookupId = lookupId.split('@')[0];
        }
        const meta = metadataMap.get(lookupId);
        
        // Merge data
        return {
            name: c.name, // Name from M3U is usually display-ready
            url: c.url,
            logo: c.logo || (meta ? meta.logo : null),
            
            // Location
            country: (meta && meta.country) ? meta.country : c.country,
            city: meta ? meta.city : null,
            subdivision: meta ? meta.subdivision : null,
            
            // Classification
            categories: (meta && meta.categories && meta.categories.length > 0) ? meta.categories : (c.group ? [c.group] : []),
            languages: (meta && meta.languages && meta.languages.length > 0) ? meta.languages : (c.language ? [c.language] : []),
            language: (meta && meta.languages && meta.languages.length > 0) ? meta.languages[0] : (c.language || 'Unknown'),

            // Extra Info
            website: meta ? meta.website : null,
            broadcast_area: meta ? meta.broadcast_area : null,
            is_nsfw: meta ? meta.is_nsfw : false,
            launched: meta ? meta.launched : null,
            
            // Technical
            tvg_id: c.tvgId
        };
    });

    // Save to file
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(enrichedChannels, null, 2));
    console.log(`Successfully saved ${enrichedChannels.length} enriched channels to ${OUTPUT_FILE}`);
}

run().catch(console.error);
