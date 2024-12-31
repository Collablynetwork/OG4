import dotenv from 'dotenv';
import { trackedPairs } from './pairs.js';
import { sendTelegramMessage, editTelegramMessage } from './telegram.js';
import axios from 'axios';
import { checkConditions } from './strategy.js';

dotenv.config();

const BINANCE_API_URL = process.env.BINANCE_API_KEY;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_IDS;

let openTrades = {}; // To track open trades by token
let recentSignals = {}; // To track recent signals

// Fetch 24-hour ticker data for a specific pair
async function fetchData(pair) {
    try {
        const endpoint = `${BINANCE_API_URL}ticker/24hr?symbol=${pair}`;
        const response = await axios.get(endpoint);
        return response.data;
    } catch (error) {
        console.error(`Error fetching data for ${pair}:`, error.message);
        return null;
    }
}

// Fetch RSI values for a specific pair and interval
async function fetchRSI(pair, interval) {
    try {
        const endpoint = `${BINANCE_API_URL}klines?symbol=${pair}&interval=${interval}&limit=14`;
        const response = await axios.get(endpoint);
        const closes = response.data.map(kline => parseFloat(kline[4]));
        return calculateRSI(closes);
    } catch (error) {
        console.error(`Error fetching RSI for ${pair} on interval ${interval}:`, error.message);
        return null;
    }
}

// Calculate RSI
function calculateRSI(closes) {
    let gains = 0, losses = 0;
    for (let i = 1; i < closes.length; i++) {
        const diff = closes[i] - closes[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const averageGain = gains / 14;
    const averageLoss = losses / 14;
    if (averageLoss === 0) return 100; // Avoid division by zero
    const rs = averageGain / averageLoss;
    return 100 - (100 / (1 + rs));
}

// Monitor pairs for trading signals
async function monitorPairs() {
    for (const pair of trackedPairs) {
        try {
            console.log(`Monitoring pair: ${pair}`);

            // Skip pairs recently signaled
            if (recentSignals[pair] && Date.now() - recentSignals[pair] < 4 * 60 * 60 * 1000) {
                console.log(`Skipping ${pair}, already signaled within 4 hours.`);
                continue;
            }

            // Fetch ticker data and validate conditions
            const tickerData = await fetchData(pair);
            if (!tickerData || parseFloat(tickerData.priceChangePercent) <= 0) {
                console.log(`No significant price change for ${pair}.`);
                continue;
            }

            const rsi1d = await fetchRSI(pair, '1d');
            const rsi4h = await fetchRSI(pair, '4h');
            const rsi15m = await fetchRSI(pair, '15m');
            const rsi1m = await fetchRSI(pair, '1m');

            if (!rsi1d || !rsi4h || !rsi15m || !rsi1m) {
                console.log(`Insufficient RSI data for ${pair}.`);
                continue;
            }

            console.log(`RSI for ${pair}: 1d=${rsi1d}, 4h=${rsi4h}, 15m=${rsi15m}, 1m=${rsi1m}`);

            const conditionsMet = checkConditions(rsi1d, rsi4h, rsi15m, rsi1m, parseFloat(tickerData.priceChangePercent));
            if (conditionsMet && !openTrades[pair]) {
                console.log(`Conditions met for ${pair}. Preparing buy signal...`);

                const currentPrice = parseFloat(tickerData.lastPrice);
                const buyRange = [
                    (currentPrice * 0.99).toFixed(8),
                    currentPrice.toFixed(8),
                ];
                const sellPrice = (currentPrice * 1.011).toFixed(8);

                const btcData = await fetchData('BTCUSDT');
                const btcPrice = parseFloat(btcData.lastPrice).toFixed(2);
                const btcChange = parseFloat(btcData.priceChangePercent).toFixed(2);

                const message = `
📢 **Buy Signal**
💎 Token: #${symbol}
💰 Buy Price: ${currentPrice}
💰 Sell Price: ${sellPrice}
🕒 Timeframe: 1m${btcInfo}
💹 Trade Now on: [Binance](https://www.binance.com/en/trade/${symbol})
`;

                try {
                    const messageId = await sendTelegramMessage(TELEGRAM_CHAT_ID, message);
                    console.log(`Telegram message sent for ${pair}. Message ID: ${messageId}`);

                    openTrades[pair] = {
                        buyRange,
                        sellPrice,
                        messageId,
                        buyTimestamp: Date.now(),
                        lowestPrice: currentPrice,
                    };

                    recentSignals[pair] = Date.now();
                } catch (error) {
                    console.error(`Failed to send Telegram message for ${pair}:`, error.message);
                }
            }
        } catch (error) {
            console.error(`Error monitoring pair ${pair}:`, error.message);
        }
    }

    // Check for target hits
    await checkOpenTrades();
}

// Check for sell target achievements
async function checkOpenTrades() {
    for (const pair in openTrades) {
        try {
            const trade = openTrades[pair];
            const tickerData = await fetchData(pair);
            const currentPrice = parseFloat(tickerData.lastPrice);

            // Update lowest price
            if (currentPrice < trade.lowestPrice) {
                trade.lowestPrice = currentPrice;
            }

            // Check if sell target is hit
            if (currentPrice >= parseFloat(trade.sellPrice)) {
                console.log(`Sell target hit for ${pair}.`);

                const duration = getDuration(Date.now() - trade.buyTimestamp);
                const percentageDrop = (
                    ((trade.lowestPrice - parseFloat(trade.buyRange[1])) /
                        parseFloat(trade.buyRange[1])) *
                    100
                ).toFixed(2);

                const btcData = await fetchData('BTCUSDT');
                const btcPrice = parseFloat(btcData.lastPrice).toFixed(2);
                const btcChange = parseFloat(btcData.priceChangePercent).toFixed(2);

                const updatedMessage = `
📢 **Buy Signal**
💎 Token: #${pair}
💰 Buy Range: ${trade.buyRange[0]} - ${trade.buyRange[1]}
💰 Sell Price: ${trade.sellPrice}
📉 Bottom Price: ${trade.lowestPrice.toFixed(8)}
📉 Percentage Drop: ${percentageDrop}%
₿ BTC Price: $${btcPrice} (${btcChange}%)
✅ Target Achieved
⏱️ Duration: ${duration}
💹 Traded on: [Binance](https://www.binance.com/en/trade/${pair})
`;

                await editTelegramMessage(TELEGRAM_CHAT_ID, trade.messageId, updatedMessage);
                delete openTrades[pair];
            }
        } catch (error) {
            console.error(`Error checking trade for ${pair}:`, error.message);
        }
    }
}

function getDuration(milliseconds) {
    const seconds = Math.floor((milliseconds / 1000) % 60);
    const minutes = Math.floor((milliseconds / (1000 * 60)) % 60);
    const hours = Math.floor((milliseconds / (1000 * 60 * 60)) % 24);

    return `${hours}h ${minutes}m ${seconds}s`;
}

// Start monitoring
console.log('The bot is running and monitoring pairs...');
setInterval(monitorPairs, 20000); // Check every 20 seconds
