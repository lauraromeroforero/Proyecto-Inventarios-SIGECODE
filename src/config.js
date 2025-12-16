const { config } = require('dotenv');
config();

const PORT = parseInt(process.env.PORT, 10) || 5000;
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '0000';
const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_DATABASE = process.env.DB_DATABASE || 'control_inventarios';
const DB_PORT = parseInt(process.env.DB_PORT, 10) || 3306;

module.exports={
    PORT,
    DB_USER,
    DB_PASSWORD,
    DB_HOST,
    DB_DATABASE,
    DB_PORT
}
