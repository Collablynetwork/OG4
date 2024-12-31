import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_API_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export async function sendTelegramMessage(chatId, message) {
    try {
        const endpoint = `${TELEGRAM_API_URL}/sendMessage`;
        const response = await axios.post(endpoint, {
            chat_id: chatId,
            text: message,
            parse_mode: 'MarkdownV2', // Use MarkdownV2 for formatting
        });
        return response.data.result.message_id; // Return message ID for editing later
    } catch (error) {
        console.error('Error sending Telegram message:', error);
    }
}

export async function editTelegramMessage(chatId, messageId, updatedMessage) {
    try {
        const endpoint = `${TELEGRAM_API_URL}/editMessageText`;
        await axios.post(endpoint, {
            chat_id: chatId,
            message_id: messageId,
            text: updatedMessage,
        });
    } catch (error) {
        console.error('Error editing Telegram message:', error);
    }
}