export function checkConditions(rsi1d, rsi4h, rsi15m, rsi1m, priceChangePercent) {
    return (
        priceChangePercent >= -15 && priceChangePercent <= 50 && // Updated condition for priceChangePercent
        rsi1d >= 50 && rsi1d <= 60 &&
        rsi4h >= 55 && rsi4h <= 65 &&
        rsi15m >= 20 && rsi15m <= 40 &&
        rsi1m >= 30 && rsi1m <= 50
    );
}
