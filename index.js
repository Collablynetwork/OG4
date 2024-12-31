import dotenv from 'dotenv';
import { trackedPairs } from './pairs.js';
import { EXCLUDED_PAIRS } from './excludedPairs.js';
import { handleRSI, checkTargetAchieved } from './strategy.js';

dotenv.config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_IDS = process.env.TELEGRAM_CHAT_IDS.split(','); // Split multiple chat IDs into an array
const fetchCandlestickData = async (symbol, interval) => {
  const url = `https://api.binance.com/api/v3/klines`;
  const params = { symbol, interval, limit: RSI_PERIOD + 1 };
  
  try {
    const response = await fetchWithRetry(url, params);
    return response.data.map((candle) => parseFloat(candle[4])); // Closing prices
  } catch (error) {
    console.error(`Error fetching ${interval} data for ${symbol}:`, error.message);
    return null;
  }
};


// Function to monitor tokens
const monitorTokens = async () => {
  console.log('Monitoring started...');
  const usdtPairs = trackedPairs.filter(
    (pair) => !EXCLUDED_PAIRS.includes(pair) && pair.endsWith('USDT')
  );

  if (usdtPairs.length > 0) {
    console.log('Monitoring pairs:', usdtPairs.join(', '));
    const promises = usdtPairs.map((pair) =>
      handleRSI(pair, TELEGRAM_TOKEN, CHAT_IDS) // Pass CHAT_IDS to handleRSI
    );
    await Promise.all(promises);
  } else {
    console.log('No valid USDT pairs found.');
  }

  console.log('Monitoring completed.');
};

// Main function
const main = async () => {
  await monitorTokens();
  setInterval(monitorTokens, 60000);
  setInterval(() => checkTargetAchieved(TELEGRAM_TOKEN, CHAT_IDS), 60000); // Pass CHAT_IDS to checkTargetAchieved
};

// Start monitoring
main();
