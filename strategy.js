import axios from 'axios';
import moment from 'moment';
import { sendTelegramMessage, editTelegramMessage } from './telegram.js';
import fs from 'fs';

// Define log file paths
const RSI_LOG_FILE = './rsi_data.csv';
const BUY_SIGNAL_LOG_FILE = './buy_signals.csv';

// Global constants
const RSI_PERIOD = 14;
const RSI_THRESHOLDS = {
  '1d': { min: 55, max: 65 },
  '4h': { min: 40, max: 55 },
  '15m': { min: 10, max: 30 },
  '1m': { min: 35, max: 50 },
};

// Global trackers
const lastNotificationTimes = {};
const sellPrices = {};
const bottomPrices = {};
let lastBTCPrice = null;
const btcPriceHistory = [];

// Initialize log files
const initializeLogFiles = () => {
  if (!fs.existsSync(RSI_LOG_FILE)) {
    fs.writeFileSync(RSI_LOG_FILE, 'Timestamp,Symbol,RSI_1d,RSI_4h,RSI_15m,RSI_1m,Current Price\n');
  }
  if (!fs.existsSync(BUY_SIGNAL_LOG_FILE)) {
    fs.writeFileSync(
      BUY_SIGNAL_LOG_FILE,
      'Timestamp,Symbol,RSI_1d,RSI_4h,RSI_15m,RSI_1m,Buy Price,Sell Price,Duration,Bottom Price,Percentage Drop,BTC Change,BTC 30m Change\n'
    );
  }
};
initializeLogFiles();

// Function to calculate RSI
const calculateRSI = (prices, period = RSI_PERIOD) => {
  if (prices.length < period) return null;

  let gains = 0,
    losses = 0;
  for (let i = 1; i < period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
};

// Fetch candlestick data
const fetchCandlestickData = async (symbol, interval) => {
  try {
    const url = `https://api.binance.com/api/v3/klines`;
    const params = {
      symbol,
      interval,
      limit: RSI_PERIOD + 1,
    };

    const response = await axios.get(url, { params });
    return response.data.map((candle) => parseFloat(candle[4])); // Closing prices
  } catch (error) {
    console.error(`Error fetching ${interval} data for ${symbol}:`, error);
    return null;
  }
};

// Fetch and calculate RSI for a specific interval
const fetchAndCalculateRSI = async (symbol, interval) => {
  const prices = await fetchCandlestickData(symbol, interval);
  return prices ? calculateRSI(prices) : null;
};

// Fetch current BTC price and maintain history
const fetchBTCPrice = async () => {
  try {
    const response = await axios.get('https://api.binance.com/api/v3/ticker/price', {
      params: { symbol: 'BTCUSDT' },
    });
    const price = parseFloat(response.data.price);

    // Add price to history with timestamp
    btcPriceHistory.push({
      price,
      timestamp: moment(),
    });

    // Keep only last 31 minutes of history (extra minute for safety)
    const thirtyOneMinutesAgo = moment().subtract(31, 'minutes');
    while (btcPriceHistory.length > 0 && btcPriceHistory[0].timestamp.isBefore(thirtyOneMinutesAgo)) {
      btcPriceHistory.shift();
    }

    return price;
  } catch (error) {
    console.error('Error fetching BTC price:', error);
    return null;
  }
};

// Calculate BTC price changes
const calculateBTCChanges = async () => {
  const currentBTCPrice = await fetchBTCPrice();
  if (!currentBTCPrice) return { price: null, change: null, change30m: null };

  // Calculate immediate change
  let priceChange = null;
  if (lastBTCPrice) {
    priceChange = ((currentBTCPrice - lastBTCPrice) / lastBTCPrice * 100).toFixed(2);
  }

  // Calculate 30-minute change
  let priceChange30m = null;
  if (btcPriceHistory.length > 0) {
    const thirtyMinutesAgo = moment().subtract(30, 'minutes');
    const oldPrice = btcPriceHistory.find((entry) => entry.timestamp.isSameOrBefore(thirtyMinutesAgo));
    if (oldPrice) {
      priceChange30m = ((currentBTCPrice - oldPrice.price) / oldPrice.price * 100).toFixed(2);
    }
  }

  lastBTCPrice = currentBTCPrice;
  return {
    price: currentBTCPrice,
    change: priceChange,
    change30m: priceChange30m,
  };
};

// Log RSI and price data
const logRSIAndPrice = (symbol, rsi1d, rsi4h, rsi15m, rsi1m, currentPrice) => {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  const logData = `${timestamp},${symbol},${rsi1d},${rsi4h},${rsi15m},${rsi1m},${currentPrice}\n`;

  fs.appendFile(RSI_LOG_FILE, logData, (err) => {
    if (err) console.error('Error writing to RSI log file:', err);
    else console.log(`Logged RSI and price for ${symbol}`);
  });
};

// Log buy signals
const logBuySignal = (symbol, rsi1d, rsi4h, rsi15m, rsi1m, buyPrice, sellPrice, duration, bottomPrice, percentageDrop, btcChange, btcChange30m) => {
  const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');
  const logData = `${timestamp},${symbol},${rsi1d},${rsi4h},${rsi15m},${rsi1m},${buyPrice},${sellPrice},${duration},${bottomPrice},${percentageDrop},${btcChange},${btcChange30m}\n`;

//  fs.appendFile(BUY_SIGNAL_LOG_FILE, logData, (err) => {
//    if (err) console.error('Error writing to buy_signals.csv:', err);
//    else console.log(`Logged Buy Signal for ${symbol}`);
//  });
};

// Fetch RSI for all timeframes
const fetchRSIForAllTimeframes = async (symbol) => {
  const timeframes = ['1d', '4h', '15m', '1m'];
  const rsiData = {};

  for (const timeframe of timeframes) {
    const prices = await fetchCandlestickData(symbol, timeframe);
    rsiData[timeframe] = prices ? calculateRSI(prices) : null;
  }

  return rsiData;
};

// Check if RSI values meet the thresholds
const checkRSIThresholds = (rsiData) => {
  for (const [timeframe, rsi] of Object.entries(rsiData)) {
    const { min, max } = RSI_THRESHOLDS[timeframe];
    if (rsi === null || rsi < min || rsi > max) return false;
  }
  return true;
};

// Handle RSI logic with multiple timeframes
export const handleRSI = async (symbol, token, chatIds) => {
  const rsiData = await fetchRSIForAllTimeframes(symbol);
  const btcData = await calculateBTCChanges();
  const currentPrice = (await fetchCandlestickData(symbol, '1m'))?.slice(-1)[0];

  if (!currentPrice || !checkRSIThresholds(rsiData)) return;

  console.log(`RSI for ${symbol}:`, rsiData, `Price = ${currentPrice}`);

  // Log RSI and price data
  logRSIAndPrice(
    symbol,
    rsiData['1d'],
    rsiData['4h'],
    rsiData['15m'],
    rsiData['1m'],
    currentPrice
  );

  const currentTime = moment();
  const lastNotificationTime = lastNotificationTimes[symbol];
  if (lastNotificationTime && currentTime.diff(lastNotificationTime, 'minutes') < 30) return;

  lastNotificationTimes[symbol] = currentTime;

  const buyRangeMin = (currentPrice * 0.99).toFixed(8);
  const buyRangeMax = currentPrice.toFixed(8);
  const sellPrice = (currentPrice * 1.011).toFixed(8);

  const btcInfo = btcData.price
    ? `\n💲 BTC Price: $${btcData.price.toFixed(2)}${btcData.change ? ` (${btcData.change > 0 ? '+' : ''}${btcData.change}%)` : ''}${btcData.change30m ? `\n📊 BTC 30m Change: ${btcData.change30m > 0 ? '+' : ''}${btcData.change30m}%` : ''}`
    : '';

  const message = `
📢 *Buy Signal*
💎 Token: #${symbol}
💰 Buy Range: ${buyRangeMin} - ${buyRangeMax}
💰 Sell Price: ${sellPrice}
🕒 Timeframe: 1m
💹 Trade Now on: [Binance](https://www.binance.com/en/trade/${symbol})
`;

  // Send messages to all chat IDs
  for (const chatId of chatIds) {
    await sendTelegramMessage(token, chatId, message);
  }

  // Track sell and bottom prices
  sellPrices[symbol] = {
    buyPrice: currentPrice,
    sellPrice,
    buyTime: currentTime,
    btcPriceAtBuy: btcData.price,
  };
  bottomPrices[symbol] = currentPrice; // Initialize bottom price
};

// Check if sell target is achieved
export const checkTargetAchieved = async (token, chatIds) => {
  for (const symbol in sellPrices) {
    const { sellPrice, buyPrice, buyTime, btcPriceAtBuy } = sellPrices[symbol];
    const prices = await fetchCandlestickData(symbol, '1m');
    const btcData = await calculateBTCChanges();

    if (!prices) continue;

    const currentPrice = prices[prices.length - 1];

    // Update bottom price
    if (currentPrice < bottomPrices[symbol]) {
      bottomPrices[symbol] = currentPrice;
    }

    // Check if sell target is reached
    if (currentPrice >= sellPrice) {
      const duration = moment.duration(moment().diff(buyTime));
      const period = `${duration.hours()}h ${duration.minutes()}m ${duration.seconds()}s`;

      const bottomPrice = bottomPrices[symbol];
      const percentageDrop = (((buyPrice - bottomPrice) / buyPrice) * 100).toFixed(2);

      const btcChange = btcPriceAtBuy && btcData.price
        ? ((btcData.price - btcPriceAtBuy) / btcPriceAtBuy * 100).toFixed(2)
        : null;

      const btcInfo = btcData.price
        ? `\n₿  BTC Price: $${btcData.price.toFixed(2)}${btcChange ? ` (${btcChange > 0 ? '+' : ''}${btcChange}%)` : ''}${btcData.change30m ? `\n📊 BTC 30m Change: ${btcData.change30m > 0 ? '+' : ''}${btcData.change30m}%` : ''}`
        : '';

      const newMessage = `
📢 *Buy Signal*
💎 Token: #${symbol}
💰 Buy Price: ${buyPrice}
💰 Sell Price: ${sellPrice}
🕒 Timeframe: 1m
📉 Bottom Price: ${bottomPrice}
📉 Percentage Drop: ${percentageDrop}%${btcInfo}
✅ Target Achieved
⏱️ Duration: ${period}
💹 Traded on: [Binance](https://www.binance.com/en/trade/${symbol})
`;

      // Send updates to all chat IDs
      for (const chatId of chatIds) {
        await editTelegramMessage(token, chatId, sellPrices[symbol].messageId, newMessage);
      }

      // Log buy signal
      logBuySignal(symbol, rsiData['1d'], rsiData['4h'], rsiData['15m'], rsiData['1m'], buyPrice, sellPrice, period, bottomPrice, percentageDrop, btcChange, btcData.change30m);

      // Cleanup
      delete sellPrices[symbol];
      delete bottomPrices[symbol];
    }
  }
};
