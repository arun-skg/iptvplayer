# IPTV Player Pro

A modern, web-based IPTV player that aggregates public IPTV channels and enriches them with detailed metadata for an enhanced viewing experience.

## Overview

This project automatically fetches public IPTV channels from the [iptv-org](https://github.com/iptv-org/iptv) repository and combines them with rich metadata (logos, categories, countries, languages) to create a user-friendly channel list. The player is designed to be lightweight and fast, deployable directly as a static site or on the edge using Cloudflare Pages/Workers.

## Features

-   **Client-Side Focused:** Operates entirely in the browser, no server-side logic required for basic playback.
-   **Automated Channel Aggregation:** Fetches the latest public channels from `iptv-org`.
-   **Metadata Enrichment:** Enhances channel data with logos, genres, broadcast areas, and more.
-   **Intelligent AI Classifier:** Automatically categorizes channels by language based on name and URL, with a special focus on accurately identifying Tamil channels.
-   **Advanced Proxy Strategy:**
    -   Utilizes a series of public CORS proxies to bypass browser restrictions on playing streams.
    -   Includes a custom HLS.js loader to intelligently rewrite relative paths in playlists, fixing playback for complex streams.
-   **Web Player:** Clean interface for browsing, searching, and filtering channels directly in the browser.
-   **VLC Integration:** Seamlessly open any channel in VLC Player.
-   **Edge Deployment:** Optimized for deployment on Cloudflare Pages for global low-latency access.

## Prerequisites

-   [Node.js](https://nodejs.org/) (v16 or higher for the build step)
-   [npm](https://www.npmjs.com/)

## Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/arun-skg/iptvplayer.git
    cd iptvplayer
    ```

2.  Install dependencies:
    ```bash
    npm install
    ```

## Usage

### 1. Enrich Channel Data

Before the first run, you need to fetch the channel list from `iptv-org` and enrich it with metadata.

```bash
node enrich_channels.js
```

This script will create the `enriched_channels.json` file in your project root.

### 2. Run Locally

To run the player locally, you just need a simple static file server.

```bash
npm start
```
This command uses `npx serve .` to host the files. Open your browser to the address shown (usually `http://localhost:3000`).

## Deployment (Cloudflare Pages)

This project is perfectly suited for a static site deployment on Cloudflare Pages.

1.  **Push to GitHub:** Ensure your project is pushed to a GitHub repository.
2.  **Create a Cloudflare Pages Project:**
    -   Log in to your Cloudflare dashboard.
    -   Go to **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**.
    -   Select your repository.
3.  **Build Settings:**
    -   **Framework preset:** `None`
    -   **Build command:** `node enrich_channels.js`
    -   **Build output directory:** `/` (This is not a standard build output, but since we are serving from the root, this works. For more complex setups, you would adjust this).
    -   _Note: The build command runs the enrichment script, ensuring your channel list is up-to-date on every deploy._
4.  **Deploy!**

## Optional: Cloudflare Worker for CORS Proxy

For the most robust playback experience, you can deploy the included Cloudflare Worker as a private CORS proxy.

1.  **Deploy the Worker:**
    ```bash
    npx wrangler deploy src/worker.js --name your-iptv-proxy
    ```
2.  **Update `index.html`:** In the `PROXIES` array in `index.html`, uncomment or change the `/proxy` entry to point to your deployed worker's URL.

## Project Structure

-   `src/worker.js`: Optional Cloudflare Worker for a private CORS proxy.
-   `enrich_channels.js`: Node.js script for data fetching and processing.
-   `index.html`: The main frontend player interface.
-   `enriched_channels.json`: Generated JSON file containing the processed channel list.
-   `wrangler.json`: Cloudflare Workers configuration.

## License

ISC
