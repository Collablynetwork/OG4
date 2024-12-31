export function checkConditions(rsi1d, rsi4h, rsi15m, rsi1m) {
    return (
        rsi1d >= 0 && rsi1d <= 100 &&
        rsi4h >= 45 && rsi4h <= 70 &&
        rsi15m >= 0 && rsi15m <= 80 &&
        rsi1m >= 30 && rsi1m <= 50
    );
}
